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
      }}
    />
  );
}
