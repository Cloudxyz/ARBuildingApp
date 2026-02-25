/**
 * src/ar/loadTexture.ts
 *
 * Expo Go compatible texture loader.
 *
 * THREE.TextureLoader.load() needs a plain http/file URL. In Expo Go,
 * bundled assets don't have a reachable URL directly — we must use
 * expo-asset to resolve and optionally download the local file URI first,
 * then hand that URI to TextureLoader.
 */
import { Asset } from 'expo-asset';
import * as THREE from 'three';

/**
 * Loads a Metro-bundled image (e.g. `require('../../assets/textures/building/albedo.jpg')`)
 * as a THREE.Texture.
 *
 * Returns `null` if the file cannot be resolved or decoded so callers can
 * fall back to a plain-colour material gracefully.
 */
export async function loadTextureFromAsset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assetModule: any,
): Promise<THREE.Texture | null> {
  try {
    const [asset] = await Asset.loadAsync(assetModule as number);
    const uri = asset.localUri ?? asset.uri;
    if (!uri) return null;

    return await new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        uri,
        (tex) => {
          // expo-gl does not support UNPACK_FLIP_Y_WEBGL (pixelStorei warning).
          // Disable flipY so Three.js never calls that parameter.
          tex.flipY = false;
          resolve(tex);
        },
        undefined,      // onProgress — not needed
        (err) => reject(err),
      );
    });
  } catch {
    return null;
  }
}
