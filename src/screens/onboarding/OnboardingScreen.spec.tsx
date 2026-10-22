import { render, screen } from '@testing-library/react-native';

import { useSetupObservation } from './useSetupObservation';
import { OnboardingScreen } from './OnboardingScreen';

jest.mock('./useSetupObservation', () => ({useSetupObservation:jest.fn(() => ({jobs:[],now:100000,unavailable:false}))}));

jest.mock('@/core/state/environmentProfile', () => ({readEnvironmentProfile: async () => 'termux-local'}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));

jest.mock('@/core/integrations/termux/termuxBridgeClient', () => ({
  getBootstrapInstallCommand: async () => ({ command: 'bash ~/skid-bootstrap/install-termux.sh' }),
  getTermuxStatus: async () => ({ installed: true, permissionGranted: true }),
  openTermuxAppSettings: async () => true,
}));

describe('OnboardingScreen', () => {
  it('starts on the Termux step with a continue action', async () => {
    await render(<OnboardingScreen />);

    expect(screen.getAllByText('Connect Termux & Python')[0]).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Check my phone' })).toBeOnTheScreen();
    expect(screen.getAllByTestId(/^setup-task-/)).toHaveLength(6);
    expect(screen.getAllByText(/^Estimate:/)).toHaveLength(6);
  });
});

it('puts a recovered Kali installation in the current task with live download progress', async () => {
  jest.mocked(useSetupObservation).mockReturnValue({jobs:[{id:'saved-kali',type:'setup.nethunter',projectId:'system-onboarding',providerId:'provider.termux.setup',capabilityId:'workstation.setup',status:'running',artifactIds:[],setup:{phase:'downloading',downloadedBytes:50,totalBytes:100}}],now:100000,unavailable:false});
  await render(<OnboardingScreen/>);
  expect(screen.getByText('TASK 2 OF 6 · Oni is working')).toBeOnTheScreen();
  expect(screen.getByRole('progressbar',{name:'Current task: Install Kali & security tools'})).toHaveProp('accessibilityValue',{min:0,max:100,now:50});
  expect(screen.getByText(/50% of the Kali download, not the whole task/)).toBeOnTheScreen();
  expect(screen.getByRole('button',{name:'Check saved installation'})).toBeOnTheScreen();
});

it('does not ask the user to begin database work that is already running', async () => {
  jest.mocked(useSetupObservation).mockReturnValue({jobs:[{id:'saved-database',type:'database.initialize',projectId:'system-onboarding',providerId:'provider.termux.postgresql',capabilityId:'metasploit.database',status:'running',artifactIds:[]}],now:100000,unavailable:false});
  await render(<OnboardingScreen/>);
  expect(screen.getByText('TASK 3 OF 6 · Oni is working')).toBeOnTheScreen();
  expect(screen.queryByText(/Continue to install PostgreSQL/)).not.toBeOnTheScreen();
});
