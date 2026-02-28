Building3DOverlay loads this file by default:
`assets/models/EEB_015.glb`

If the file is missing or invalid, the 3D overlay shows an error state.
There is no automatic fallback in Building3DOverlay.

Recommended: export a GLB from Blender with:
- Y-up axis
- Scale applied
- Materials baked
- Max ~5 MB for mobile performance
