import { Text, View } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
export function ActiveProjectBadge() {
  const { colors } = useTheme();
  return <View style={{ alignSelf: 'flex-start', borderRadius: 6, backgroundColor: colors.selection, paddingHorizontal: 12, paddingVertical: 8 }}>
    <Text style={{ color: colors.onAccent, fontWeight: '700' }}>✓ Active project</Text>
  </View>;
}
