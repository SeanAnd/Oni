import { Image, StyleSheet, View } from 'react-native';
import { assets } from '@/theme/assets';
import { useTheme } from './ThemeProvider';
export function SurfaceTexture({ terminal = false }: { terminal?: boolean }) {
  const { theme } = useTheme();
  if (theme.treatment !== 'ink') return null;
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}><Image accessible={false} source={terminal ? assets.terminalInk : assets.ink} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: 0.55 }]} /></View>;
}
