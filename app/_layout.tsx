import { ModalProvider } from '@/components/modals/ModalProvider';
import { ApplicationBoundary } from '@/components/ApplicationBoundary';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as SystemUI from 'expo-system-ui';
import { WorkstationLifecycle } from '@/components/WorkstationLifecycle';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { NavigationMenu } from '@/components/NavigationChrome';
import { StartupGate } from '@/components/startup/StartupGate';
export default function RootLayout() {
  return <ThemeProvider><ApplicationBoundary><WorkstationLifecycle /><StartupGate><ModalProvider><Navigation /></ModalProvider></StartupGate></ApplicationBoundary></ThemeProvider>;
}
function Navigation() {
  const { theme, colors } = useTheme();
  useEffect(() => { void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {}); }, [colors.background]);
  return <><StatusBar style={theme.mode === 'light' ? 'dark' : 'light'} /><Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, contentStyle: { backgroundColor: colors.background }, headerTitleStyle: { fontFamily: theme.fonts.heading }, headerRight: () => <NavigationMenu /> }}>
    <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    <Stack.Screen name="environment" options={{ title: 'Environment' }} />
    <Stack.Screen name="onboarding" options={{ title: 'Setup' }} />
    <Stack.Screen name="welcome" options={{ title: 'Welcome' }} />
    <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    <Stack.Screen name="metasploit" options={{ title: 'Metasploit' }} />
    <Stack.Screen name="tools/index" options={{ title: 'Tools' }} />
    <Stack.Screen name="tools/nmap" options={{ title: 'Network scan' }} />
    <Stack.Screen name="projects/[projectId]" options={{ title: 'Project' }} />
    <Stack.Screen name="jobs/[jobId]" options={{ title: 'Job detail' }} />
    <Stack.Screen name="artifacts/index" options={{ title: 'Artifacts' }} />
    <Stack.Screen name="artifacts/[artifactId]" options={{ title: 'Artifact detail' }} />
  </Stack></>;
}
