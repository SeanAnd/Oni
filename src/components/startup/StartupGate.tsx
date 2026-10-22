import { useCallback, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import { StartupAnimation } from './StartupAnimation';
export function StartupGate({ children }: { children: ReactNode }) {
  const { ready } = useTheme();
  const [laidOut, setLaidOut] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const dismiss = useCallback(() => setDismissed(true), []);
  return <View style={{ flex: 1 }}>
    <View style={{ flex: 1 }} onLayout={event => { if (event.nativeEvent.layout.width > 0 && event.nativeEvent.layout.height > 0) setLaidOut(true); }} pointerEvents={dismissed ? 'auto' : 'none'} accessibilityElementsHidden={!dismissed} importantForAccessibility={dismissed ? 'auto' : 'no-hide-descendants'}>{children}</View>
    {!dismissed && <StartupAnimation appReady={ready && laidOut} onComplete={dismiss} />}
  </View>;
}
