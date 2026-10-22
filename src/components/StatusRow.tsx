import { SurfaceTexture } from './SurfaceTexture';
import { Text, View } from 'react-native';
import { useTheme } from './ThemeProvider';
export function StatusRow({ label, detail, ok }: { label: string; detail: string; ok?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ padding: 16, gap: 8, backgroundColor: colors.surface, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: colors.surfaceBorder }}>
    <SurfaceTexture />
    <Text style={{ color: colors.surfaceText, fontSize: 17, fontWeight: '600' }}>{label}</Text>
    <Text style={{ color: ok === true ? colors.success : colors.surfaceMuted, fontSize: 13 }}>{ok === true ? '✓ Verified' : ok === false ? '! Needs attention' : '○ Not verified'}</Text>
    <Text style={{ color: colors.surfaceText, fontSize: 16, lineHeight: 24 }}>{detail}</Text>
  </View>;
}
