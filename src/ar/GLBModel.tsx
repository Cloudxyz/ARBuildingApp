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
import { Renderer, loadAsync } from 'expo-three';
import * as THREE from 'three';
import { Asset } from 'expo-asset';
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
        const gltf  = await loadAsync(asset.localUri ?? asset.uri);

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
