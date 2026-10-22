import { render, screen, userEvent } from '@testing-library/react-native';
import { ReadinessPanel } from './ReadinessPanel';
import { refreshEnvironmentSample } from '@/core/integrations/system/environmentSnapshot';
import { enqueueKaliHealthJob } from '@/core/jobs/jobClient';
jest.mock('@/core/integrations/system/environmentSnapshot', () => ({refreshEnvironmentSample:jest.fn(async () => ({snapshot:{
  termux:{label:'Termux',ok:true,detail:'Permission granted'},kali:{label:'Kali',ok:true,detail:'Tools verified'},
  database:{label:'PostgreSQL',ok:false,detail:'Database stopped'},metasploit:{label:'Framework',ok:false,detail:'Authentication unavailable'},
}}))}));
jest.mock('@/core/jobs/jobClient', () => ({enqueueKaliHealthJob:jest.fn(async () => ({ok:true}))}));
it('does no work on revisit and shows independent live results only on explicit recheck', async () => {
  await render(<ReadinessPanel />);
  expect(refreshEnvironmentSample).not.toHaveBeenCalled();
  expect(enqueueKaliHealthJob).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button',{name:'Recheck readiness'}));
  expect(screen.getByText('Tools verified')).toBeOnTheScreen();
  expect(screen.getByText('Database stopped')).toBeOnTheScreen();
  expect(screen.getByText('Authentication unavailable')).toBeOnTheScreen();
  expect(enqueueKaliHealthJob).not.toHaveBeenCalled();
  await userEvent.press(screen.getByRole('button',{name:'Test Kali'}));
  expect(enqueueKaliHealthJob).toHaveBeenCalledTimes(1);
});
