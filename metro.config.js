const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Reduce file watchers to avoid EMFILE errors on Windows
config.watchFolders = [__dirname];

config.resolver.blockList = [
  /node_modules\/.*\/node_modules\/.*/,
];

// Disable package.json `exports` field resolution.
// three@0.183 has an invalid exports map (references non-existent example files)
// which causes noisy-but-harmless Metro warnings. Disabling exports resolution
// here makes Metro fall back to classic file-based resolution for all packages,
// which is correct and safe for Expo Go.
config.resolver.unstable_enablePackageExports = false;

// Bundle .glb files as binary assets
const { assetExts, sourceExts } = config.resolver;
config.resolver.assetExts = [...assetExts, 'glb', 'gltf', 'bin', 'obj', 'mtl'];

module.exports = config;
