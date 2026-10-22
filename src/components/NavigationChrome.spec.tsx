import { render, screen, userEvent, act } from '@testing-library/react-native';
import { NavigationMenu } from './NavigationChrome';
const mockNavigate=jest.fn();
jest.mock('expo-router', () => ({useRouter: () => ({navigate:mockNavigate})}));
it('exposes Setup and direct workflows, removing redundant destinations before navigation', async () => {
  await render(<NavigationMenu />);
  await userEvent.press(screen.getByRole('button',{name:'Open navigation menu'}));
  expect(screen.getByRole('button',{name:'Setup'})).toBeOnTheScreen();
  for (const name of ['Environment','Tools','Metasploit']) expect(screen.queryByRole('button',{name})).toBeNull();
  await userEvent.press(screen.getByRole('button',{name:'Network scan'}));
  expect(screen.queryByText('Your workstation')).toBeNull();
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(mockNavigate).toHaveBeenCalledWith('/tools/nmap');
});
