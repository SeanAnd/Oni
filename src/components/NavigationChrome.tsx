import { useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { useTheme } from './ThemeProvider';
import { Icon, type IconName } from './Icon';
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];
const destinations: { label: string; path: Href; icon: IconName }[] = [
  { label: 'Home', path: '/', icon: 'home' }, { label: 'Setup', path: '/onboarding', icon: 'setup' }, { label: 'Projects', path: '/projects', icon: 'layers' },
  { label: 'Terminal', path: '/terminal', icon: 'terminal' }, { label: 'Network scan', path: '/tools/nmap', icon: 'shield' }, { label: 'Jobs', path: '/jobs', icon: 'logs' },
  { label: 'Artifacts', path: '/artifacts', icon: 'copy' },
  { label: 'Settings', path: '/settings', icon: 'setup' },
];
export function NavigationMenu() {
  const [visible, setVisible] = useState(false);
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const trigger = useRef<View>(null);
  const heading = useRef<Text>(null);
  const close = () => {
    setVisible(false);
    requestAnimationFrame(() => { const tag = findNodeHandle(trigger.current); if (tag) AccessibilityInfo.setAccessibilityFocus(tag); });
  };
  return <>
    <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel="Open navigation menu" onPress={() => setVisible(true)} style={{ minWidth: 64, minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}><Text style={{ color: colors.text, fontSize: 16 }}>Menu</Text></Pressable>
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} onShow={() => { const tag = findNodeHandle(heading.current); if (tag) AccessibilityInfo.setAccessibilityFocus(tag); }}>
      <View style={{ flex: 1, backgroundColor: colors.canvas, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 8 }}><Text ref={heading} accessibilityRole="header" style={{ color: colors.text, backgroundColor: colors.background, padding: 16, fontSize: 26 }}>Your workstation</Text>
          {destinations.map(item => <Pressable key={item.label} accessibilityRole="button" onPress={() => { close(); requestAnimationFrame(() => router.navigate(item.path)); }} style={{ minHeight: 56, padding: 16, flexDirection: 'row', gap: 16, alignItems: 'center', backgroundColor: colors.surface }}><Icon name={item.icon} color={colors.surfaceText} /><Text style={{ color: colors.surfaceText, fontSize: 18 }}>{item.label}</Text></Pressable>)}
          <Pressable accessibilityRole="button" onPress={close} style={{ padding: 16, minHeight: 56 }}><Text style={{ color: colors.surfaceText, fontSize: 18 }}>Close menu</Text></Pressable>
        </ScrollView>
      </View>
    </Modal>
  </>;
}
export function WorkstationTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const icons: Record<string, IconName> = { index: 'home', projects: 'layers', terminal: 'terminal', jobs: 'logs' };
  return <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.surfaceBorder, paddingBottom: insets.bottom }}>
    {state.routes.map((route, index) => <Pressable key={route.key} accessibilityRole="tab" accessibilityState={{ selected: state.index === index }} onPress={() => {
      const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
      if (state.index !== index && !event.defaultPrevented) navigation.navigate(route.name);
    }} style={{ flex: 1, minHeight: 72, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 6 }}>
      <Icon name={icons[route.name] ?? 'info'} color={state.index === index ? colors.accentBright : colors.surfaceMuted} />
      <Text style={{ fontSize: 12, color: state.index === index ? colors.surfaceText : colors.surfaceMuted }}>{descriptors[route.key].options.title ?? route.name}</Text>
      <View style={{ width: 24, height: 3, backgroundColor: state.index === index ? colors.accentBright : 'transparent' }} />
    </Pressable>)}
  </View>;
}
