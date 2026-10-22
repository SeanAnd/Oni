import type { Ref } from 'react';
import { SurfaceTexture } from './SurfaceTexture';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useTheme } from './ThemeProvider';
import { assets } from '@/theme/assets';
import { Icon, PaintedIcon } from './Icon';
export function TileGrid({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{children}</View>;
}
export function ToolTile({ title, detail, icon, onPress, buttonRef }: { buttonRef?: Ref<View>; title: string; detail: string; icon: keyof typeof assets.icons; onPress: () => void }) {
  const { width, fontScale } = useWindowDimensions();
  const { colors, theme } = useTheme();
  return <Pressable ref={buttonRef} accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ width: width < 375 || fontScale > 1.25 ? '100%' : '48%', flexGrow: 1, minHeight: 116, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: 12, overflow: 'hidden', padding: 14, gap: 10, opacity: pressed ? 0.8 : 1 })}>
    <SurfaceTexture />
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><PaintedIcon name={icon} /><Icon name="chevron" size={18} color={colors.surfaceMuted} /></View>
    <Text style={{ color: colors.surfaceText, fontSize: 20, fontFamily: theme.fonts.heading }}>{title}</Text>
    <Text style={{ color: colors.surfaceMuted, fontSize: 13, lineHeight: 19 }}>{detail}</Text>
  </Pressable>;
}
