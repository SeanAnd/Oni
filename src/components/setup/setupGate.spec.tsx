import { render, screen, userEvent, act } from '@testing-library/react-native';
import { SETUP_TASKS } from '@/core/models/setupTask.model';
import { writeOnboardingProgress } from '@/core/state/onboardingProgress';
import { ModalProvider } from '../modals/ModalProvider';
import { ActionButton } from '../ActionButton';
import { SetupStatusNotice } from './SetupStatusNotice';
import { useSetupGate } from './useSetupGate';
import * as SecureStore from 'expo-secure-store';
function Consumer({start}: {start: () => void}) {
  const check=useSetupGate();
  return <><SetupStatusNotice /><ActionButton label="Start work" onPress={() => { void check().then(allowed => { if (allowed) start(); }); }} /></>;
}
it('does not prompt on Home hydration, blocks work, and reacts to completed checkpoints without replaying work', async () => {
  await writeOnboardingProgress({completedSteps:[],onboardingComplete:true},'termux-local');
  const start=jest.fn();
  await render(<ModalProvider><Consumer start={start} /></ModalProvider>);
  expect(await screen.findByText('Setup required · 0 of 6 tasks verified')).toBeOnTheScreen();
  expect(screen.queryByText('Finish setting up Oni')).toBeNull();
  await userEvent.press(screen.getByRole('button',{name:'Start work'}));
  expect(screen.getByText('Finish setting up Oni')).toBeOnTheScreen();
  expect(start).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button',{name:'Not now'}));
  await act(async () => { await writeOnboardingProgress({completedSteps:[...SETUP_TASKS],onboardingComplete:false},'termux-local'); });
  expect(screen.queryByText(/Setup required/)).toBeNull();
  expect(start).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button',{name:'Start work'}));
  expect(start).toHaveBeenCalledTimes(1);
});
it('shows distinct read-failure copy and never dispatches after Retry', async () => {
  jest.mocked(SecureStore.getItemAsync).mockRejectedValue(new Error('locked'));
  const start=jest.fn();
  await render(<ModalProvider><Consumer start={start} /></ModalProvider>);
  expect(await screen.findByText('Setup status unavailable')).toBeOnTheScreen();
  expect(screen.queryByText(/0 of 6/)).toBeNull();
  await userEvent.press(screen.getByRole('button',{name:'Start work'}));
  expect(screen.getByRole('button',{name:'Retry'})).toBeOnTheScreen();
  await userEvent.press(screen.getByRole('button',{name:'Retry'}));
  expect(start).not.toHaveBeenCalled();
});

jest.mock('expo-secure-store', () => {
  const values = new Map<string,string>();
  return {getItemAsync:jest.fn(async (key:string) => values.get(key) ?? null),setItemAsync:jest.fn(async (key:string,value:string) => {values.set(key,value);})};
});
