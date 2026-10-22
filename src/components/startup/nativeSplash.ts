import { Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';

// Module scope is intentional: do not wait for React's first effect to hold it.
if (Platform.OS !== 'web') {
  void SplashScreen.preventAutoHideAsync().catch(error => {
    console.warn('[startup] Could not retain the native splash screen.', error);
  });
}

/** The React overlay must already be laid out with loaded artwork. */
export async function hideNativeSplash(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await SplashScreen.hideAsync();
  } catch (error) {
    // Expo Go/dev reloads may not have a registered native splash to hide.
    console.warn('[startup] Native splash handoff was unavailable.', error);
  }
}
