import { render, screen, userEvent } from '@testing-library/react-native';
import { TerminalScreen } from './TerminalScreen';
import { openTerminal, closeTerminal, terminalStatus } from '@/core/integrations/terminal/terminalClient';
import { ModalProvider } from '@/components/modals/ModalProvider';
import { checkSetupAccess } from '@/core/state/setupReadiness';
jest.mock('@/core/state/setupReadiness', () => ({checkSetupAccess:jest.fn(async () => ({allowed:true}))}));
jest.mock('@/core/state/useSetupReadiness', () => ({useSetupReadinessLifecycle:jest.fn()}));
jest.mock('@/core/integrations/terminal/terminalClient',()=>({
  terminalStatus:jest.fn(),
  openTerminal:jest.fn(async()=>({state:'running',detail:'Connected · termux',preset:'termux'})),closeTerminal:jest.fn(),
}));
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(terminalStatus).mockReturnValue({state:'idle',detail:'Start a terminal session.',preset:'termux'});
  jest.mocked(openTerminal).mockImplementation(async preset => {
    const status = {state:'running' as const, detail:`Connected · ${preset}`, preset};
    jest.mocked(terminalStatus).mockReturnValue(status);
    return status;
  });
});
it('mounts without creating a shell and starts only on explicit action',async()=>{
 const view=await render(<TerminalScreen />);
 expect(openTerminal).not.toHaveBeenCalled();
 await userEvent.press(screen.getByRole('button',{name:'Start terminal'}));
 expect(openTerminal).toHaveBeenCalledWith('termux');
 expect(screen.getByLabelText('Interactive Termux terminal')).toBeOnTheScreen();
 await view.unmount();
});
it('requires an explicit themed confirmation before closing an owned terminal', async () => {
  const view=await render(<ModalProvider><TerminalScreen /></ModalProvider>);
  await userEvent.press(screen.getByRole('button',{name:'Start terminal'}));
  await userEvent.press(screen.getByRole('button',{name:'Close session'}));
  expect(screen.getByRole('header',{name:'Close terminal session?'})).toBeOnTheScreen();
  await userEvent.press(screen.getByRole('button',{name:'Cancel'}));
  expect(closeTerminal).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button',{name:'Close session'}));
  jest.mocked(closeTerminal).mockResolvedValue({state:'idle',detail:'Closed',preset:'termux'});
  // The dialog button is the only enabled Close session button while pending.
  const confirm=screen.getByRole('button',{name:'Close session',disabled:false});
  await userEvent.press(confirm);
  expect(closeTerminal).toHaveBeenCalledTimes(1);
  await view.unmount();
});
it('selects Metasploit alongside Kali and starts it inside the native terminal', async () => {
  const view=await render(<TerminalScreen />);
  expect(screen.getAllByRole('radio').map(choice => choice.props.accessibilityState.checked)).toEqual([true,false,false]);
  expect(screen.queryByRole('button',{name:'Open Metasploit in Termux'})).toBeNull();
  await userEvent.press(screen.getByRole('radio',{name:'Metasploit'}));
  expect(openTerminal).not.toHaveBeenCalled();
  expect(screen.getByRole('radio',{name:'Metasploit',checked:true})).toBeOnTheScreen();
  await userEvent.press(screen.getByRole('button',{name:'Start terminal'}));
  expect(checkSetupAccess).toHaveBeenCalledTimes(1);
  expect(openTerminal).toHaveBeenCalledWith('metasploit');
  expect(screen.getByLabelText('Interactive Termux terminal')).toBeOnTheScreen();
  await view.unmount();
});
it('does not start Metasploit when the setup prompt is declined', async () => {
  jest.mocked(checkSetupAccess).mockResolvedValueOnce({allowed:false,errorKey:'SETUP_REQUIRED',detail:'Finish Setup'});
  const view=await render(<ModalProvider><TerminalScreen /></ModalProvider>);
  await userEvent.press(screen.getByRole('radio',{name:'Metasploit'}));
  await userEvent.press(screen.getByRole('button',{name:'Start terminal'}));
  await userEvent.press(screen.getByRole('button',{name:'Not now'}));
  expect(openTerminal).not.toHaveBeenCalled();
  await view.unmount();
});
