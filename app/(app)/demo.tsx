import { Stack } from 'expo-router';
import ARViewsDemoScreen from '../../src/demo/ARViewsDemoScreen';

export default function DemoRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'AR Views Demo', headerShown: true }} />
      <ARViewsDemoScreen />
    </>
  );
}
