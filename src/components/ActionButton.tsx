import type { Ref } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { assets } from '@/theme/assets';
import { useTheme } from './ThemeProvider';
interface ActionButtonProps {
  buttonRef?: Ref<View>;
  label: string; onPress: () => void; disabled?: boolean; accessibilityHint?: string;
  variant?: 'primary' | 'outline';
}
export function ActionButton({ buttonRef, label, onPress, disabled = false, accessibilityHint, variant = 'primary' }: ActionButtonProps) {
  const { theme, colors } = useTheme();
  return <Pressable ref={buttonRef} accessibilityRole="button" accessibilityHint={accessibilityHint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
    style={({ pressed }) => ({ minHeight: 56, borderRadius: 10, overflow: 'hidden', padding: 16, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: variant === 'outline' ? colors.border : colors.accent, backgroundColor: variant === 'outline' ? 'transparent' : colors.accent, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 })}>
    {theme.treatment === 'ink' && variant === 'primary' && <View style={StyleSheet.absoluteFill} pointerEvents="none" accessible={false}><Image source={assets.crimson} style={{ width: '100%', height: '100%' }} resizeMode="cover" accessible={false} /></View>}
    <Text style={{ color: variant === 'outline' ? colors.text : colors.onAccent, fontSize: 18, fontFamily: theme.fonts.heading, textAlign: 'center' }}>{label}</Text>
  </Pressable>;
}
