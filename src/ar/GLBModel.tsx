/**
 * src/ar/GLBModel.tsx
 *
 * Loads a local .glb asset and renders it inside a GLView.
 * If loading fails, shows an error message — no fallback to procedural building.
 *
 * Usage:
 *   import { GLBModel } from '../ar/GLBModel';
 *   <GLBModel source={require('../../assets/models/EEB_015.glb')} config={...} ... />
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GLView, ExpoWebGLRenderingContext } from 'expo-gl';
import { Renderer } from 'expo-three';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
import { loadArrayBufferAsync } from 'expo-three/build/loaders/loadModelsAsync';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ARModelConfig } from '../types';

// ── Props ─────────────────────────────────────────────────────────────────────
interface GLBModelProps {
  /** require('../../assets/models/test.glb') */
  source?: number | null;
  config: ARModelConfig;
  isPlaying: boolean;
  animKey: number;
  width: number;
  height: number;
  containerAnimatedStyle?: object;
}

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

function stripEmbeddedTexturesFromGlb(source: ArrayBuffer): ArrayBuffer {
  const data = new DataView(source);
  if (data.byteLength < 20 || data.getUint32(0, true) !== 0x46546c67) {
    throw new Error('Invalid GLB header');
  }

  const JSON_CHUNK_TYPE = 0x4e4f534a;
  const BIN_CHUNK_TYPE = 0x004e4942;
  const pad4 = (n: number) => (n + 3) & ~3;

  let offset = 12;
  let jsonChunk: Uint8Array | null = null;
  let binChunk: Uint8Array | null = null;

  while (offset + 8 <= data.byteLength) {
    const chunkLength = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;
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
    gltf.extensionsUsed = (gltf.extensionsUsed as unknown[]).filter((name) => {
      if (typeof name !== 'string') return true;
      return !name.toLowerCase().includes('texture');
    });
  }
  if (Array.isArray(gltf.extensionsRequired)) {
    gltf.extensionsRequired = (gltf.extensionsRequired as unknown[]).filter((name) => {
      if (typeof name !== 'string') return true;
      return !name.toLowerCase().includes('texture');
    });
  }

  const encodedJson = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPaddedLength = pad4(encodedJson.length);
  const binLength = binChunk ? binChunk.length : 0;
  const binPaddedLength = pad4(binLength);

  const totalLength =
    12 +
    8 + jsonPaddedLength +
    (binChunk ? 8 + binPaddedLength : 0);

  const out = new ArrayBuffer(totalLength);
  const outView = new DataView(out);
  const outBytes = new Uint8Array(out);

  outView.setUint32(0, 0x46546c67, true);
  outView.setUint32(4, 2, true);
  outView.setUint32(8, totalLength, true);

  let outOffset = 12;
  outView.setUint32(outOffset, jsonPaddedLength, true);
  outView.setUint32(outOffset + 4, JSON_CHUNK_TYPE, true);
  outOffset += 8;
  outBytes.set(encodedJson, outOffset);
  outBytes.fill(0x20, outOffset + encodedJson.length, outOffset + jsonPaddedLength);
  outOffset += jsonPaddedLength;

  if (binChunk) {
    outView.setUint32(outOffset, binPaddedLength, true);
    outView.setUint32(outOffset + 4, BIN_CHUNK_TYPE, true);
    outOffset += 8;
    outBytes.set(binChunk, outOffset);
  }

  return out;
}

// ── Component ─────────────────────────────────────────────────────────────────
export const GLBModel: React.FC<GLBModelProps> = ({
  source,
  config,
  isPlaying,
  animKey,
  width,
  height,
  containerAnimatedStyle,
}) => {
  const [errorMsg, setErrorMsg] = useState<string | null>(!source ? 'No GLB source provided' : null);
  const [glbLoaded, setGlbLoaded] = useState(false);

  const isPlayingRef = useRef(isPlaying);
  const raffRef      = useRef<number>(0);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const onContextCreate = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      if (!source) {
        setErrorMsg('No GLB source provided');
        return;
      }

      try {
        const renderer = new Renderer({ gl, width, height, pixelRatio: 1, alpha: true });
        renderer.setSize(width, height);
        renderer.setClearColor(0x000000, 0);

        const scene  = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 200);
        camera.position.set(0, 7, 9);
        camera.lookAt(0, 2, 0);

        const ambient  = new THREE.AmbientLight(0xffffff, 0.7);
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
        dirLight.position.set(4, 10, 6);
        scene.add(ambient, dirLight);

        // Load the GLB asset
        const asset = Asset.fromModule(source);
        await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) throw new Error('Model asset URI is unavailable');
        const sourceArrayBuffer = await loadArrayBufferAsync({ uri, onProgress: undefined });
        const texturelessArrayBuffer = stripEmbeddedTexturesFromGlb(
          sourceArrayBuffer as ArrayBuffer,
        );
        const loader = new GLTFLoader();
        const gltf: any = await new Promise((resolve, reject) => {
          loader.parse(texturelessArrayBuffer, '', resolve, reject);
        });

        const model = gltf.scene ?? gltf;
        // Auto-scale to fit ~3 world units
        const box    = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size   = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        model.scale.multiplyScalar(3 / maxDim);
        model.position.sub(center.multiplyScalar(3 / maxDim));
        scene.add(model);

        setGlbLoaded(true);

        const animate = () => {
          raffRef.current = requestAnimationFrame(animate);
          if (isPlayingRef.current) model.rotation.y += 0.005;
          renderer.render(scene, camera);
          gl.endFrameEXP();
        };
        raffRef.current = requestAnimationFrame(animate);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GLBModel] Failed to load GLB:', msg);
        setErrorMsg(msg);
      }
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => () => { cancelAnimationFrame(raffRef.current); }, []);

  // Error state — no fallback, show message only
  if (errorMsg) {
    return (
      <Animated.View
        style={[StyleSheet.absoluteFill, containerAnimatedStyle]}
        pointerEvents="none"
      >
        <View style={styles.errorOverlay}>
          <Text style={styles.errorTitle}>Model failed to load</Text>
          <Text style={styles.errorDetail} numberOfLines={4}>{errorMsg}</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, containerAnimatedStyle]}
      pointerEvents="none"
    >
      <GLView style={{ width, height }} onContextCreate={onContextCreate} />
      {!glbLoaded && (
        <View style={styles.loadingBadge}>
          <Text style={styles.loadingText}>LOADING MODEL...</Text>
        </View>
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  errorOverlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  errorTitle: {
    color: '#ff6b6b',
    fontSize: 15,
    fontWeight: '600',
  },
  errorDetail: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  loadingBadge: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  loadingText: {
    color: '#00d4ff',
    fontSize: 10,
    letterSpacing: 2,
  },
});

export default GLBModel;
