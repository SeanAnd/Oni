import { Tabs } from 'expo-router';
import { useTheme } from '@/components/ThemeProvider';
import { NavigationMenu, WorkstationTabBar } from '@/components/NavigationChrome';
export default function TabLayout() {
  const { colors } = useTheme();
  return <Tabs tabBar={props => <WorkstationTabBar {...props} />} screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerRight: () => <NavigationMenu /> }}>
    <Tabs.Screen name="index" options={{ title: 'Home' }} /><Tabs.Screen name="projects" options={{ title: 'Projects' }} /><Tabs.Screen name="terminal" options={{ title: 'Terminal' }} /><Tabs.Screen name="jobs" options={{ title: 'Jobs' }} />
  </Tabs>;
}
