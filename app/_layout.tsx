import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { RoleProvider } from '../src/lib/RoleContext';
import { DialogProvider } from '../src/lib/dialog';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <RoleProvider>
          <DialogProvider>
            <StatusBar style="light" translucent={false} backgroundColor="#0d0d22" />
            <Stack screenOptions={{ headerShown: false }} />
          </DialogProvider>
        </RoleProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
