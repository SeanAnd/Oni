import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { setupReadiness } from './setupReadiness';

export function useSetupReadiness() {
  useFocusEffect(useCallback(() => { void setupReadiness.refresh(); }, []));
  return useSyncExternalStore(setupReadiness.subscribe, setupReadiness.getSnapshot);
}
export function useSetupReadinessLifecycle() {
  useEffect(() => {
    void setupReadiness.refresh();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void setupReadiness.refresh(); });
    return () => subscription.remove();
  }, []);
}
