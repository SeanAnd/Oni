import { useRouter } from 'expo-router';
import { Screen, PageHeader, Body } from '@/components/Screen';
import { ActionButton } from '@/components/ActionButton';
export function WelcomeScreen() {
  const router = useRouter();
  return <Screen><PageHeader title="Make it yours" subtitle="A security workstation. On your device." hero />
    <Body>Connect Termux and NetHunter, prepare your database, and verify Framework. Setup resumes from the checks you have already completed.</Body>
    <ActionButton label="Set up or resume" onPress={() => router.push('/onboarding')} />
    <ActionButton label="Continue to projects" variant="outline" onPress={() => router.push('/projects')} />
    <Body muted>Your projects live locally. No account is required.</Body>
  </Screen>;
}
