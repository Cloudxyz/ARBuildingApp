/**
 * src/magic/buildingTextures.ts
 *
 * Loads PBR textures from assets/textures/building/ once and caches them.
 * Expo Go compatible — uses expo-asset + expo-three loadTextureAsync.
 *
 * Texture files expected:
 *   albedo.jpg     → baseColor (sRGB)
 *   ao.jpg         → ambient occlusion (linear)
 *   normal.jpg     → normal map (linear)
 *   roughness.jpg  → roughness (linear)
 */

import { Asset } from 'expo-asset';
import { loadTextureAsync } from 'expo-three';
import * as THREE from 'three';

export interface BuildingTextures {
  albedo:    THREE.Texture;
  ao:        THREE.Texture;
  normal:    THREE.Texture;
  roughness: THREE.Texture;
}

// Module-level cache — textures survive re-renders and are loaded only once.
let _cache: BuildingTextures | null = null;
let _loadPromise: Promise<BuildingTextures> | null = null;

/**
 * Load (or return cached) building PBR textures.
 * @param textureScale  UV repeat count applied to all maps (default 4).
 */
export async function loadBuildingTextures(textureScale = 4): Promise<BuildingTextures> {
  // Return existing cache immediately if available.
  if (_cache) return _cache;

  // Avoid duplicate concurrent loads.
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    try {
      // 1. Resolve Expo assets (download to local cache if needed).
      const [albedoAsset, aoAsset, normalAsset, roughnessAsset] = await Promise.all([
        Asset.fromModule(require('../../assets/textures/building/albedo.jpg')).downloadAsync(),
        Asset.fromModule(require('../../assets/textures/building/ao.jpg')).downloadAsync(),
        Asset.fromModule(require('../../assets/textures/building/normal.jpg')).downloadAsync(),
        Asset.fromModule(require('../../assets/textures/building/roughness.jpg')).downloadAsync(),
      ]);

      // 2. Load into THREE textures via expo-three.
      //    loadTextureAsync's internal async IIFE does not propagate all errors
      //    to reject(), so we race each load against a 10-second timeout to
      //    prevent the whole chain from hanging forever.
      const withTimeout = <T>(p: Promise<T>, ms = 10_000): Promise<T> =>
        Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('Texture load timeout')), ms))]);

      const [albedo, ao, normal, roughness] = await Promise.all([
        withTimeout(loadTextureAsync({ asset: albedoAsset })),
        withTimeout(loadTextureAsync({ asset: aoAsset })),
        withTimeout(loadTextureAsync({ asset: normalAsset })),
        withTimeout(loadTextureAsync({ asset: roughnessAsset })),
      ]);

      // 3. Color-space: albedo is sRGB, all others stay linear.
      albedo.colorSpace = THREE.SRGBColorSpace;

      // 4. Tiling.
      for (const tex of [albedo, ao, normal, roughness]) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(textureScale, textureScale);
        tex.needsUpdate = true;
      }

      const result: BuildingTextures = { albedo, ao, normal, roughness };
      _cache = result;
      return result;
    } catch (err) {
      // Reset so the next call can retry instead of returning this failed promise.
      _loadPromise = null;
      throw err;
    }
  })();

  return _loadPromise;
}

/**
 * Dispose all cached textures and clear the cache.
 * Call this if you ever need to reload textures (e.g., on unmount of the whole feature).
 */
export function disposeBuildingTextures(): void {
  if (!_cache) return;
  _cache.albedo.dispose();
  _cache.ao.dispose();
  _cache.normal.dispose();
  _cache.roughness.dispose();
  _cache = null;
  _loadPromise = null;
}
