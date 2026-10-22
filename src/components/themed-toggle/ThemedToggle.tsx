import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Pressable, Text, View } from 'react-native';
import type { ThemeId } from '@/theme/palettes';
import { useTheme } from '../ThemeProvider';
import { useReducedMotion } from '../useReducedMotion';
import { ToggleArtwork } from './ToggleArtwork';
import { durations } from './toggleScenes';

export interface ThemedToggleProps {
  value: boolean; onValueChange: (value: boolean) => void; label: string;
  themeId?: ThemeId; disabled?: boolean; mode?: 'switch' | 'radio';
  size?: 'compact' | 'showcase'; accessibilityHint?: string; testID?: string;
  palette?: readonly string[];
}
export function ThemedToggle({ value, onValueChange, label, themeId, disabled = false, mode = 'switch', size = 'compact', accessibilityHint, testID, palette }: ThemedToggleProps) {
  const { theme, colors } = useTheme();
  const id = themeId ?? theme.id;
  const reduced = useReducedMotion();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  const [width, setWidth] = useState(0);
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));
  const previous = useRef(value);
  const still = reduced || !active || size === 'compact';
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    progress.stopAnimation();
    if (still || previous.current === value) progress.setValue(value ? 1 : 0);
    else Animated.timing(progress, { toValue: value ? 1 : 0, duration: durations[id], easing: Easing.inOut(Easing.cubic), useNativeDriver: false, isInteraction: false }).start();
    previous.current = value;
    return () => progress.stopAnimation();
  }, [value, still, progress, id]);
  return <Pressable testID={testID} accessible accessibilityRole={mode} accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ checked: value, disabled }} disabled={disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPress={() => { if (mode !== 'radio' || !value) onValueChange(mode === 'radio' ? true : !value); }}
    style={{ width: '100%', maxWidth: 360, minHeight: 48, padding: theme.spacing.sm, borderWidth: 2, borderRadius: theme.radius.control, borderColor: focused || value ? colors.accent : colors.border, opacity: disabled ? 0.5 : 1 }}>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: theme.spacing.xs }}>
      <Text style={{ color: colors.text, fontSize: theme.type.body }}>{label}{palette && value ? ' ✓' : ''}</Text>
      {palette ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
        {palette.map((color, index) => <View key={index} style={{ width: theme.spacing.md, height: theme.spacing.md, borderRadius: theme.spacing.sm, backgroundColor: color, borderWidth: 1, borderColor: colors.border }} />)}
      </View> : <Text style={{ color: colors.muted, fontSize: theme.type.label }}>{mode === 'radio' ? value ? 'Selected' : 'Select' : value ? 'On' : 'Off'}</Text>}
      <View onLayout={event => setWidth(event.nativeEvent.layout.width)} style={{ width: '100%', maxWidth: size === 'compact' ? 220 : 360, alignSelf: 'center' }}>
        <ToggleArtwork themeId={id} value={value} progress={progress} width={width} still={still || width === 0} />
      </View>
    </View>
  </Pressable>;
}
