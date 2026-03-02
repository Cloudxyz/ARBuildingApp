/**
 * src/lib/glbLoader.ts
 *
 * Shared GLB loading pipeline + THREE.js disposal helpers.
 * Single source of truth — imported by Building3DOverlay, IsometricBlueprintView,
 * GLBModel, and any future 3D screen.
 *
 * Design goals:
 *  - Zero redundant copies of stripEmbeddedTexturesFromGlb / assertRemoteSizeOk
 *  - LRU cache (max 5 entries) keyed by resolved URI avoids re-downloading
 *    the same file during a session (tab switches, demo ↔ unit navigation)
 *  - dispose helpers prevent GPU/JS memory from compounding across navigations
 */

import { Asset } from 'expo-asset';
import { loadArrayBufferAsync } from 'expo-three/build/loaders/loadModelsAsync';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A `require('…/model.glb')` asset number OR a remote/local URI string. */
export type GlbSource = number | string;

// ─────────────────────────────────────────────────────────────────────────────
// GLB binary manipulation
// ─────────────────────────────────────────────────────────────────────────────

function removeTextureRefsDeep(node: unknown): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach(removeTextureRefsDeep);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const lower = key.toLowerCase();
    if (
      lower.includes('texture') &&
      value &&
      typeof value === 'object' &&
      typeof (value as { index?: unknown }).index === 'number'
    ) {
      delete obj[key];
      continue;
    }
    removeTextureRefsDeep(value);
  }
}

/**
 * Strips all embedded texture/image/sampler data from a GLB binary.
 * In Expo Go, creating Blob from large ArrayBuffers crashes on Android.
 * Removing textures keeps the geometry + materials but avoids that allocation.
 */
export function stripEmbeddedTexturesFromGlb(source: ArrayBuffer): ArrayBuffer {
  const data = new DataView(source);
  if (data.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Invalid GLB header');
  }

  const JSON_CHUNK_TYPE = 0x4e4f534a;
  const BIN_CHUNK_TYPE  = 0x004e4942;
  const pad4 = (n: number) => (n + 3) & ~3;

  let offset  = 12;
  let jsonChunk: Uint8Array | null = null;
  let binChunk:  Uint8Array | null = null;

  while (offset + 8 <= data.byteLength) {
    const chunkLength = data.getUint32(offset, true);
    const chunkType   = data.getUint32(offset + 4, true);
    const chunkStart  = offset + 8;
    const chunkEnd    = chunkStart + chunkLength;
    if (chunkEnd > data.byteLength) break;

    const bytes = new Uint8Array(source.slice(chunkStart, chunkEnd));
    if (chunkType === JSON_CHUNK_TYPE) jsonChunk = bytes;
    else if (chunkType === BIN_CHUNK_TYPE && !binChunk) binChunk = bytes;

    offset = chunkEnd;
  }

  if (!jsonChunk) throw new Error('GLB JSON chunk not found');

  const jsonText = new TextDecoder().decode(jsonChunk).trim();
  const gltf = JSON.parse(jsonText) as Record<string, unknown>;

  delete gltf.images;
  delete gltf.textures;
  delete gltf.samplers;
  removeTextureRefsDeep(gltf);

  if (Array.isArray(gltf.extensionsUsed)) {
    gltf.extensionsUsed = (gltf.extensionsUsed as unknown[]).filter(
      (n) => typeof n !== 'string' || !n.toLowerCase().includes('texture'),
    );
  }
  if (Array.isArray(gltf.extensionsRequired)) {
    gltf.extensionsRequired = (gltf.extensionsRequired as unknown[]).filter(
      (n) => typeof n !== 'string' || !n.toLowerCase().includes('texture'),
    );
  }

  const encodedJson       = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPaddedLength  = pad4(encodedJson.length);
  const binPaddedLength   = binChunk ? pad4(binChunk.length) : 0;

  const totalLength =
    12 +
    8 + jsonPaddedLength +
    (binChunk ? 8 + binPaddedLength : 0);

  const out      = new ArrayBuffer(totalLength);
  const outView  = new DataView(out);
  const outBytes = new Uint8Array(out);

  outView.setUint32(0, 0x46546c67, true); // magic
  outView.setUint32(4, 2, true);           // version
  outView.setUint32(8, totalLength, true);

  let outOffset = 12;
  outView.setUint32(outOffset,     jsonPaddedLength, true);
  outView.setUint32(outOffset + 4, JSON_CHUNK_TYPE,  true);
  outOffset += 8;
  outBytes.set(encodedJson, outOffset);
  outBytes.fill(0x20, outOffset + encodedJson.length, outOffset + jsonPaddedLength);
  outOffset += jsonPaddedLength;

  if (binChunk) {
    outView.setUint32(outOffset,     binPaddedLength, true);
    outView.setUint32(outOffset + 4, BIN_CHUNK_TYPE,  true);
    outOffset += 8;
    outBytes.set(binChunk, outOffset);
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// URI resolution
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a `require()` asset number or bare URI string to an absolute URI.
 * For local assets the result is a stable `file://…` path within the session.
 */
export async function resolveGlbUri(source: GlbSource): Promise<string> {
  if (typeof source === 'string') return source;
  const asset = Asset.fromModule(source);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('Model asset URI is unavailable');
  return uri;
}

// ─────────────────────────────────────────────────────────────────────────────
// Size guard
// ─────────────────────────────────────────────────────────────────────────────

/** Max GLB file we'll attempt to load on-device (Android JVM heap constraint). */
const MAX_GLB_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Issues a HEAD request for remote URIs and throws early if the file is too
 * large, preventing native OOM crashes at the ArrayBuffer allocation stage.
 */
export async function assertRemoteSizeOk(uri: string): Promise<void> {
  if (!uri.startsWith('http')) return; // local file — skip
  try {
    const res = await fetch(uri, { method: 'HEAD' });
    const len = res.headers.get('content-length');
    if (len) {
      const bytes = parseInt(len, 10);
      if (!isNaN(bytes) && bytes > MAX_GLB_BYTES) {
        const mb = (bytes / 1024 / 1024).toFixed(1);
        throw new Error(
          `GLB file is too large for this device (${mb} MB).\n\n`
          + 'Compress it to under 20 MB before uploading.\n\n'
          + 'Tools:\n'
          + '\u2022 gltf.report (browser, free)\n'
          + '\u2022 gltf-transform optimize (CLI)\n'
          + '\u2022 Blender \u2192 Export glTF 2.0 + Draco',
        );
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('too large')) throw err;
    // Swallow HEAD network errors — server may not support HEAD
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LRU cache for stripped ArrayBuffers
// ─────────────────────────────────────────────────────────────────────────────

const GLB_CACHE_MAX = 5;

/**
 * In-memory LRU cache: URI → stripped ArrayBuffer.
 *
 * - Keyed by the resolved URI string. For local `require()` assets the URI
 *   is stable within a session (same `file://` path), so the cache is
 *   effective across tab switches and Demo ↔ Unit navigations.
 * - For remote Supabase signed URLs the key is the full URL string; since the
 *   URL is resolved once per screen mount and reused throughout that mount,
 *   the cache avoids re-downloading when the same screen is revisited with the
 *   same signed URL (URL caching at the network layer handles expiry).
 * - Max 5 entries; oldest entry is evicted when the limit is reached (LRU via
 *   Map insertion order — access promotes an entry to "most recent").
 */
const glbCache = new Map<string, ArrayBuffer>();

/** @internal — exposed for Phase 4 telemetry */
export const glbCacheStats = { hits: 0, misses: 0 };

/**
 * Active GL render-loop counter. Increment when onContextCreate starts a RAF
 * loop, decrement when the unmount cleanup cancels it. In a healthy app this
 * value should equal the number of currently mounted GL views (≤ 1 per tab).
 */
export const rafLoopStats = { active: 0 };

/** Print a summary of cache + loop health to the Metro console (DEV only). */
export function logGlbStats(): void {
  // logging removed
}

function lruGet(key: string): ArrayBuffer | undefined {
  const value = glbCache.get(key);
  if (value !== undefined) {
    // Promote to most-recently-used by deleting + re-inserting
    glbCache.delete(key);
    glbCache.set(key, value);
    glbCacheStats.hits++;
  }
  return value;
}

function lruSet(key: string, value: ArrayBuffer): void {
  if (glbCache.has(key)) glbCache.delete(key); // refresh position
  glbCache.set(key, value);
  if (glbCache.size > GLB_CACHE_MAX) {
    // Evict oldest (first key in Map)
    const oldest = glbCache.keys().next().value;
    if (oldest !== undefined) glbCache.delete(oldest);
  }
}

/** Remove a specific URI from the cache (e.g., on load error to allow retry). */
export function evictGlbCache(uri: string): void {
  glbCache.delete(uri);
}

/** Clear the entire cache (call on low-memory warnings). */
export function clearGlbCache(): void {
  glbCache.clear();
  glbCacheStats.hits = 0;
  glbCacheStats.misses = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main loader — used by all 3D components
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-flight deduplication map: URI → Promise<stripped ArrayBuffer>.
 *
 * When Building3DOverlay and IsometricBlueprintView both mount at the same
 * time and call loadTexturelessGlb for the same URI, the second call arrives
 * while the first download is still in progress.  Without this map they both
 * see a cache miss and issue two independent HTTP requests for the same file.
 * With this map the second call receives the same Promise and both callers
 * share a single download.
 */
const glbInflight = new Map<string, Promise<ArrayBuffer>>();

/**
 * Full pipeline: resolve URI → size-check → download → strip textures → cache
 * → parse GLTF.
 *
 * The stripped `ArrayBuffer` is cached by URI so subsequent calls for the same
 * model are instant (parse only, no network round-trip).  Concurrent calls for
 * the same URI share a single in-flight download (deduplication).
 *
 * Returns the parsed GLTF object (same shape as `GLTFLoader.parse` resolve).
 */
export async function loadTexturelessGlb(source: GlbSource): Promise<unknown> {
  const uri = await resolveGlbUri(source);

  // ── 1. LRU cache hit (instant, no network) ──────────────────────────────
  const cached = lruGet(uri);
  if (cached) {
    const loader = new GLTFLoader();
    return await new Promise((resolve, reject) => { loader.parse(cached, '', resolve, reject); });
  }

  // ── 2. In-flight dedup — share an existing download Promise ─────────────
  const inflight = glbInflight.get(uri);
  if (inflight) {
    glbCacheStats.hits++;
    const stripped = await inflight;
    const loader = new GLTFLoader();
    return await new Promise((resolve, reject) => { loader.parse(stripped, '', resolve, reject); });
  }

  // ── 3. Cache miss — start a new download ────────────────────────────────
  glbCacheStats.misses++;

  const downloadPromise: Promise<ArrayBuffer> = (async () => {
    await assertRemoteSizeOk(uri);
    const raw = await loadArrayBufferAsync({ uri, onProgress: undefined });
    const stripped = stripEmbeddedTexturesFromGlb(raw as ArrayBuffer);
    lruSet(uri, stripped);
    return stripped;
  })().finally(() => {
    glbInflight.delete(uri);
  });

  glbInflight.set(uri, downloadPromise);

  const stripped = await downloadPromise;
  const loader = new GLTFLoader();
  return await new Promise((resolve, reject) => { loader.parse(stripped, '', resolve, reject); });
}

// ─────────────────────────────────────────────────────────────────────────────
// THREE.js resource disposal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively disposes all geometries and materials attached to an Object3D
 * subgraph. Call before removing a model from the scene on unmount.
 */
export function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;

    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    if (mesh.material) {
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((mat: THREE.Material) => {
        // Dispose any texture maps attached to the material
        const m = mat as THREE.MeshStandardMaterial & {
          map?: THREE.Texture | null;
          normalMap?: THREE.Texture | null;
          roughnessMap?: THREE.Texture | null;
          metalnessMap?: THREE.Texture | null;
          aoMap?: THREE.Texture | null;
          emissiveMap?: THREE.Texture | null;
          lightMap?: THREE.Texture | null;
          envMap?: THREE.Texture | null;
          alphaMap?: THREE.Texture | null;
        };
        const texKeys = [
          'map', 'normalMap', 'roughnessMap', 'metalnessMap',
          'aoMap', 'emissiveMap', 'lightMap', 'envMap', 'alphaMap',
        ] as const;
        texKeys.forEach((k) => {
          if (m[k]) { m[k]!.dispose(); m[k] = null; }
        });
        mat.dispose();
      });
    }
  });
}

/**
 * Safely disposes an expo-three Renderer (WebGLRenderer under the hood).
 * Frees compiled shaders, textures, and the WebGL context program cache.
 * Safe to call even if the renderer was never used.
 */
export function disposeRenderer(renderer: THREE.WebGLRenderer): void {
  try {
    renderer.renderLists.dispose();
    renderer.dispose();
  } catch {
    // Renderer may already be in a torn-down state in Expo GL — swallow
  }
}
