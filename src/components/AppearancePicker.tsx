import { Text, View } from 'react-native';
import { ThemedToggle } from './themed-toggle/ThemedToggle';
import { THEME_IDS, themes } from '@/theme/palettes';
import { useTheme } from './ThemeProvider';
export function AppearancePicker() {
  const { theme, colors, selectTheme, error } = useTheme();
  return <View accessibilityRole="radiogroup" style={{ gap: 8 }}>{THEME_IDS.map(id => <ThemedToggle key={id} mode="radio" size="showcase" themeId={id} label={themes[id].name} palette={themes[id].accents} value={theme.id === id} onValueChange={() => selectTheme(id)} />)}{error && <Text style={{ color: colors.error }}>{error}</Text>}</View>;
}
