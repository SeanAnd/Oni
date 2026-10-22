import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { ReactNode } from 'react';
import { useTheme } from './ThemeProvider';
import { assets } from '@/theme/assets';
export function ScreenFrame({ children }: { children: ReactNode }) {
  const { colors, theme } = useTheme();
  const insets = useSafeAreaInsets();
  return <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: 'center' }}><View style={{ flex: 1, width: '100%', maxWidth: 560, backgroundColor: colors.background }}>
    {theme.treatment === 'ink' && <Image source={assets.paper} resizeMode="repeat" accessible={false} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} />}
    {theme.treatment === 'neon' && <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}><Svg width="100%" height="100%"><Path d="M20 0V200L80 260V600 M100 0V160L160 220V480L220 540V1000 M300 0V120L260 160V500L320 560V1200" fill="none" stroke={colors.border} strokeWidth={1} opacity={0.4} /></Svg></View>}
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height" keyboardVerticalOffset={insets.top + 56}>{children}</KeyboardAvoidingView>
  </View></View>;
}
export function Screen({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return <ScreenFrame><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: width < 360 ? 16 : 22, paddingBottom: 40, gap: 16 }}>{children}</ScrollView></ScreenFrame>;
}
export function PageHeader({ title, subtitle, hero = false, setup = false }: { title: string; subtitle?: string; hero?: boolean; setup?: boolean }) {
  const { theme, colors } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const artVisible = fontScale < 1.4;
  return <View style={{ minHeight: hero && artVisible ? 245 : 100, paddingBottom: 8 }}>
    {artVisible && <Image accessible={false} source={setup ? assets.setupLandscape : hero ? assets.enso : assets.terminalLandscape} resizeMode="contain" style={{ position: 'absolute', right: -16, top: hero ? 30 : -10, width: hero ? 210 : 100, height: hero ? 245 : 110, opacity: theme.treatment === 'ink' ? (hero ? 0.38 : 0.18) : 0.15, tintColor: theme.treatment === 'ink' ? undefined : colors.secondaryAccent }} />}
    {hero && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 28 }}>
      <Image source={theme.id === 'ghost' ? assets.ghostLogo : assets.logo} resizeMode="contain" accessible={false} style={{ width: 52, height: 65, tintColor: theme.id === 'ghost' || theme.id === 'sumi' ? undefined : colors.accent }} />
      <View style={{ flex: 1 }}><Text style={{ color: colors.text, fontFamily: theme.fonts.heading, fontSize: 28 }}>Oni</Text><Text style={{ color: colors.muted, fontSize: 12 }}>ROOTLESS WORKSTATION</Text></View>
    </View>}
    <Text accessibilityRole="header" style={{ color: colors.text, fontFamily: theme.fonts.heading, fontWeight: '700', fontStyle: theme.treatment === 'neon' ? 'italic' : 'normal', fontSize: hero ? (width < 375 ? 32 : 36) : 32, maxWidth: '100%' }}>{title}</Text>
    <Image source={assets.underline} resizeMode="stretch" accessible={false} style={{ width: 46, height: 6, marginTop: 12, tintColor: colors.accent }} />
    {subtitle && <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 24, marginTop: 12, maxWidth: '100%' }}>{subtitle}</Text>}
  </View>;
}
export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  const { colors } = useTheme();
  return <Text style={{ fontSize: 16, lineHeight: 24, color: muted ? colors.muted : colors.text }}>{children}</Text>;
}
export function SectionTitle({ children }: { children: ReactNode }) {
  const { theme, colors } = useTheme();
  return <Text accessibilityRole="header" style={{ fontFamily: theme.fonts.heading, fontSize: 24, color: colors.text, marginTop: 8 }}>{children}</Text>;
}
