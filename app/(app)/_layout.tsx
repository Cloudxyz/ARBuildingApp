import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0d0d22' },
        headerTintColor: '#00d4ff',
        headerTitleStyle: { color: '#eeeeff', fontWeight: '700' },
        statusBarStyle: 'light',
        statusBarTranslucent: false,
        contentStyle: { backgroundColor: '#070714' },
        animation: 'slide_from_right',
      }}
    >
      {/* Static fallback titles prevent Expo Router from displaying the raw segment name */}
      <Stack.Screen name="index" options={{ title: 'App Land VR' }} />
      <Stack.Screen name="unit/[id]" options={{ title: 'Unit' }} />
      <Stack.Screen name="unit/create" options={{ title: 'Add Unit' }} />
      <Stack.Screen name="development/[id]" options={{ title: 'Development' }} />
      <Stack.Screen name="development/create" options={{ title: 'Add Development' }} />
      <Stack.Screen name="camera/[id]" options={{ title: 'AR View' }} />
      <Stack.Screen name="demo" options={{ title: 'Demo' }} />
    </Stack>
  );
}
