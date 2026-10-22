import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSetupReadiness } from '@/core/state/useSetupReadiness';
import { setupReadiness } from '@/core/state/setupReadiness';
import { useTheme } from '../ThemeProvider';
import { Icon } from '../Icon';
import { ActionButton } from '../ActionButton';

export function SetupStatusNotice() {
  const state = useSetupReadiness();
  const {theme, colors} = useTheme();
  const router = useRouter();
  if (state.status === 'complete') return null;
  return <View style={{gap:theme.spacing.sm, padding:theme.spacing.md, borderWidth:1, borderColor:colors.warning, borderRadius:theme.radius.panel}}>
    <Icon name={state.status === 'loading' ? 'info' : 'warning'} color={colors.warning} />
    <Text accessibilityLiveRegion="polite" style={{color:colors.text,fontSize:theme.type.body}}>{state.status === 'loading' ? 'Checking setup…' : state.status === 'unavailable' ? 'Setup status unavailable' : `Setup required · ${state.completed} of ${state.required} tasks verified`}</Text>
    {state.status === 'unavailable' && <ActionButton label="Retry setup check" variant="outline" onPress={() => void setupReadiness.refresh()} />}
    <ActionButton label="Open Setup" onPress={() => router.push('/onboarding')} />
  </View>;
}
