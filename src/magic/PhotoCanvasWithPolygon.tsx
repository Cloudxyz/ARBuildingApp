/**
 * src/magic/PhotoCanvasWithPolygon.tsx
 *
 * Photo background with an interactive polygon editor on top.
 * Uses react-native-svg for rendering + PanResponder for gesture capture.
 */

import React, { useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Image,
  PanResponder,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline } from 'react-native-svg';
import { applySnapping, rectangleFromDiagonal, snapDrag, SNAP_CLOSE_RADIUS } from './snapUtils';
import { CanvasPoint } from './types';
import { GRID_SIZE } from './gridConfig'; // single source of truth — edit gridConfig.ts to change grid size

// ── Constants ─────────────────────────────────────────────────────────────────
const ACCENT        = '#00d4ff';
const ACCENT_FILL   = 'rgba(0,212,255,0.18)';
const VERTEX_R      = 10;           // vertex circle radius
const VERTEX_HIT    = 22;           // touch hit radius for vertex presses
const FIRST_COLOR   = '#00ff88';    // highlight first vertex (snap target)

// ── Types ─────────────────────────────────────────────────────────────────────
type EditMode = 'draw' | 'edit';

export interface PhotoCanvasHandle {
  getPoints: () => CanvasPoint[];
  isClosed: () => boolean;
  reset: () => void;
}

export interface PhotoCanvasWithPolygonProps {
  photoUri: string;
  width: number;
  height: number;
  onPolygonChange?: (points: CanvasPoint[], closed: boolean) => void;
  /** Expose imperative API */
  ref?: React.Ref<PhotoCanvasHandle>;
}

// ── Component ─────────────────────────────────────────────────────────────────
const PhotoCanvasWithPolygon = React.forwardRef<PhotoCanvasHandle, PhotoCanvasWithPolygonProps>(
  ({ photoUri, width, height, onPolygonChange }, ref) => {
    const [points, setPoints] = useState<CanvasPoint[]>([]);
    const [closed, setClosed] = useState(false);
    const [mode, setMode] = useState<EditMode>('draw');
    const [gridEnabled, setGridEnabled] = useState(true);
    const [rectMode, setRectMode] = useState(false);
    const [selectedIdx, setSelectedIdx] = useState<number | null>(null);

    // Internal refs (used in PanResponder closures)
    const pointsRef     = useRef<CanvasPoint[]>([]);
    const closedRef     = useRef(false);
    const modeRef       = useRef<EditMode>('draw');
    const gridRef       = useRef(true);
    const rectRef       = useRef(false);
    const dragIdxRef    = useRef<number | null>(null);   // vertex being dragged
    const longPressRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasMoved      = useRef(false);

    // Keep refs in sync
    const syncState = useCallback(
      (pts: CanvasPoint[], cls: boolean) => {
        pointsRef.current = pts;
        closedRef.current = cls;
        setPoints(pts);
        setClosed(cls);
        onPolygonChange?.(pts, cls);
      },
      [onPolygonChange],
    );

    // ── Imperative handle ────────────────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      getPoints: () => pointsRef.current,
      isClosed:  () => closedRef.current,
      reset:     () => {
        syncState([], false);
        setMode('draw');
        modeRef.current = 'draw';
        setSelectedIdx(null);
      },
    }));

    // ── Helpers ──────────────────────────────────────────────────────────────
    const nearVertexIndex = useCallback(
      (raw: CanvasPoint): number | null => {
        const pts = pointsRef.current;
        for (let i = 0; i < pts.length; i++) {
          if (Math.hypot(raw.x - pts[i].x, raw.y - pts[i].y) <= VERTEX_HIT) {
            return i;
          }
        }
        return null;
      },
      [],
    );

    const handleTap = useCallback(
      (raw: CanvasPoint) => {
        const pts    = pointsRef.current;
        const cls    = closedRef.current;

        if (cls) return; // polygon closed; only edit mode can touch it

        // Rectangle mode: place 2 points then auto-close as rectangle
        if (rectRef.current && pts.length === 1) {
          const corners = rectangleFromDiagonal(pts[0], raw);
          syncState([...corners], true);
          setMode('edit');
          modeRef.current = 'edit';
          return;
        }

        const { point, shouldClose } = applySnapping(raw, pts, gridRef.current);

        if (shouldClose) {
          syncState(pts, true);
          setMode('edit');
          modeRef.current = 'edit';
          return;
        }

        syncState([...pts, point], false);
      },
      [syncState],
    );

    const deleteVertex = useCallback(
      (idx: number) => {
        const pts = [...pointsRef.current];
        pts.splice(idx, 1);
        const cls = closedRef.current && pts.length >= 3;
        syncState(pts, cls);
        setSelectedIdx(null);
      },
      [syncState],
    );

    // ── PanResponder ─────────────────────────────────────────────────────────
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder:        () => true,
        onMoveShouldSetPanResponder:         () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture:  () => true,

        onPanResponderGrant: (evt) => {
          hasMoved.current   = false;
          dragIdxRef.current = null;
          const touch = evt.nativeEvent.touches[0] ?? evt.nativeEvent;
          const raw: CanvasPoint = { x: touch.locationX, y: touch.locationY };

          if (modeRef.current === 'edit') {
            const idx = nearVertexIndex(raw) ?? null;
            dragIdxRef.current = idx;
            setSelectedIdx(idx);

            // Long-press timer → delete vertex
            if (idx !== null) {
              longPressRef.current = setTimeout(() => {
                if (!hasMoved.current) {
                  deleteVertex(idx);
                }
              }, 500);
            }
          }
        },

        onPanResponderMove: (evt) => {
          const touch = evt.nativeEvent.touches[0] ?? evt.nativeEvent;
          const raw: CanvasPoint = { x: touch.locationX, y: touch.locationY };
          hasMoved.current = true;

          if (modeRef.current === 'edit' && dragIdxRef.current !== null) {
            if (longPressRef.current) {
              clearTimeout(longPressRef.current);
              longPressRef.current = null;
            }
            const pts    = [...pointsRef.current];
            const snapped = snapDrag(raw, pts, dragIdxRef.current, gridRef.current);
            pts[dragIdxRef.current] = snapped;
            syncState(pts, closedRef.current);
          }
        },

        onPanResponderRelease: (evt) => {
          if (longPressRef.current) {
            clearTimeout(longPressRef.current);
            longPressRef.current = null;
          }
          // If no movement and not in edit drag → it's a tap
          if (
            !hasMoved.current &&
            dragIdxRef.current === null &&
            modeRef.current === 'draw'
          ) {
            const touch = evt.nativeEvent;
            handleTap({ x: touch.locationX, y: touch.locationY });
          }
          dragIdxRef.current = null;
        },

        onPanResponderTerminate: () => {
          if (longPressRef.current) {
            clearTimeout(longPressRef.current);
            longPressRef.current = null;
          }
          dragIdxRef.current = null;
        },
      }),
    ).current;

    // ── Toolbar actions ───────────────────────────────────────────────────────
    const undo = useCallback(() => {
      const pts = pointsRef.current;
      if (pts.length === 0) return;
      if (closedRef.current) {
        setClosed(false);
        closedRef.current = false;
        setMode('draw');
        modeRef.current = 'draw';
        onPolygonChange?.(pts, false);
        return;
      }
      syncState(pts.slice(0, -1), false);
    }, [syncState, onPolygonChange]);

    const closePolygon = useCallback(() => {
      if (pointsRef.current.length >= 3) {
        syncState(pointsRef.current, true);
        setMode('edit');
        modeRef.current = 'edit';
      }
    }, [syncState]);

    const toggleMode = useCallback(() => {
      const next: EditMode = modeRef.current === 'draw' ? 'edit' : 'draw';
      modeRef.current = next;
      setMode(next);
      setSelectedIdx(null);
    }, []);

    const toggleGrid = useCallback(() => {
      gridRef.current = !gridRef.current;
      setGridEnabled(gridRef.current);
    }, []);

    const toggleRect = useCallback(() => {
      rectRef.current = !rectRef.current;
      setRectMode(rectRef.current);
    }, []);

    // ── Grid lines (memoized, regenerated only when canvas dims or GRID_SIZE changes) ──
    const gridLines = useMemo(() => {
      if (!gridEnabled) return null;
      const lines: React.ReactElement[] = [];
      const cols = Math.ceil(width  / GRID_SIZE);
      const rows = Math.ceil(height / GRID_SIZE);
      for (let c = 1; c < cols; c++) {
        lines.push(
          <Line key={`gv${c}`}
            x1={c * GRID_SIZE} y1={0} x2={c * GRID_SIZE} y2={height}
            stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />,
        );
      }
      for (let r = 1; r < rows; r++) {
        lines.push(
          <Line key={`gh${r}`}
            x1={0} y1={r * GRID_SIZE} x2={width} y2={r * GRID_SIZE}
            stroke="rgba(0,212,255,0.12)" strokeWidth="0.5" />,
        );
      }
      return lines;
    }, [gridEnabled, width, height]);

    // ── SVG helpers ───────────────────────────────────────────────────────────
    const polyPoints = points.map((p) => `${p.x},${p.y}`).join(' ');

    return (
      <View style={[styles.root, { width, height }]}>
        {/* Photo background */}
        <Image
          source={{ uri: photoUri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />

        {/* Gesture capture + SVG overlay */}
        <View
          style={[StyleSheet.absoluteFill]}
          {...panResponder.panHandlers}
        >
          <Svg
            width={width}
            height={height}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          >
            {/* Grid lines — only visible when snap-to-grid is ON */}
            {gridLines}
            {/* Polygon fill when closed */}
            {closed && points.length >= 3 && (
              <Polygon
                points={polyPoints}
                fill={ACCENT_FILL}
                stroke={ACCENT}
                strokeWidth={1.5}
              />
            )}

            {/* Polyline when still drawing */}
            {!closed && points.length >= 2 && (
              <Polyline
                points={polyPoints}
                fill="none"
                stroke={ACCENT}
                strokeWidth={1.5}
                strokeDasharray="6,3"
              />
            )}

            {/* Snap-to-close indicator ring on first point */}
            {!closed && points.length >= 2 && (
              <Circle
                cx={points[0].x}
                cy={points[0].y}
                r={SNAP_CLOSE_RADIUS}
                fill="rgba(0,255,136,0.10)"
                stroke={FIRST_COLOR}
                strokeWidth={1}
                strokeDasharray="4,4"
              />
            )}

            {/* Vertex circles */}
            {points.map((p, i) => {
              const isFirst    = i === 0;
              const isSelected = i === selectedIdx;
              return (
                <Circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={isSelected ? VERTEX_R + 3 : VERTEX_R}
                  fill={isFirst && !closed ? FIRST_COLOR : isSelected ? '#fff' : ACCENT}
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth={1.5}
                />
              );
            })}
          </Svg>
        </View>

        {/* Toolbar */}
        <View style={styles.toolbar}>
          <ToolBtn label="Undo" onPress={undo} />
          {!closed && points.length >= 3 && (
            <ToolBtn label="Close" onPress={closePolygon} accent />
          )}
          {closed && (
            <ToolBtn
              label={mode === 'edit' ? '🔓 EDIT' : '🔒 LOCK'}
              onPress={toggleMode}
              accent={mode === 'edit'}
            />
          )}
          <ToolBtn
            label={`⊞ ${gridEnabled ? 'Grid ON' : 'Grid OFF'}`}
            onPress={toggleGrid}
            accent={gridEnabled}
          />
          <ToolBtn
            label={`▭ Rect${rectMode ? ' ON' : ''}`}
            onPress={toggleRect}
            accent={rectMode}
          />
        </View>

        {/* Hint */}
        <View style={styles.hint} pointerEvents="none">
          <Text style={styles.hintText}>
            {closed
              ? mode === 'edit'
                ? 'Drag vertex to adjust · Long-press to delete'
                : 'Polygon locked — tap EDIT to modify'
              : rectMode && points.length === 1
              ? 'Tap second corner to create rectangle'
              : points.length === 0
              ? 'Tap to place corners'
              : 'Continue tapping · Tap near ● to close'}
          </Text>
        </View>
      </View>
    );
  },
);

PhotoCanvasWithPolygon.displayName = 'PhotoCanvasWithPolygon';
export default PhotoCanvasWithPolygon;

// ── Micro component ───────────────────────────────────────────────────────────
function ToolBtn({
  label,
  onPress,
  accent = false,
}: {
  label: string;
  onPress: () => void;
  accent?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.toolBtn, accent && styles.toolBtnAccent]}
      activeOpacity={0.7}
    >
      <Text style={[styles.toolBtnText, accent && styles.toolBtnTextAccent]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
    backgroundColor: '#111',
  },
  toolbar: {
    position: 'absolute',
    bottom: 10,
    left: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  toolBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  toolBtnAccent: {
    backgroundColor: 'rgba(0,212,255,0.15)',
    borderColor: '#00d4ff',
  },
  toolBtnText: {
    color: '#ccc',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 0.5,
  },
  toolBtnTextAccent: {
    color: '#00d4ff',
  },
  hint: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    alignItems: 'center',
  },
  hintText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
  },
});
