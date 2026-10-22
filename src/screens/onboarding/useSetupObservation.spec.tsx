import { act, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { useSetupObservation } from './useSetupObservation';
import { listJobSummaries, reconcileJobs, enqueueJobSpec } from '@/core/jobs/jobClient';
import { readOnboardingProgress } from '@/core/state/onboardingProgress';
import type { JobSummary } from '@/core/models/job.model';

jest.mock('@/core/jobs/jobClient', () => ({listJobSummaries:jest.fn(), reconcileJobs:jest.fn(), enqueueJobSpec:jest.fn()}));
jest.mock('@/core/state/onboardingProgress', () => ({readOnboardingProgress:jest.fn()}));
const onProgress=jest.fn();
const job:JobSummary={id:'saved-kali',projectId:'system-onboarding',type:'setup.nethunter',providerId:'provider.termux.setup',capabilityId:'workstation.setup',status:'running',artifactIds:[],setup:{phase:'downloading'}};
function Harness() {
  const {jobs, unavailable}=useSetupObservation('termux-local',onProgress);
  return <Text>{unavailable?'unavailable':jobs[0]?.setup?.phase ?? 'loading'}</Text>;
}
beforeEach(()=>{
  jest.useFakeTimers();jest.clearAllMocks();
  jest.spyOn(AppState,'addEventListener').mockReturnValue({remove:jest.fn()});
  jest.mocked(reconcileJobs).mockResolvedValue(0);
  jest.mocked(readOnboardingProgress).mockResolvedValue({completedSteps:['termux'],onboardingComplete:false});
  jest.mocked(listJobSummaries).mockResolvedValue([job]);
});
afterEach(()=>jest.useRealTimers());
it('reattaches to a saved Kali job and keeps observing phases without starting an installation',async()=>{
  const view=await render(<Harness/>);
  expect(screen.getByText('downloading')).toBeOnTheScreen();
  expect(reconcileJobs).toHaveBeenCalledTimes(1);
  jest.mocked(listJobSummaries).mockResolvedValue([{...job,setup:{phase:'extracting'}}]);
  await act(async()=>{jest.advanceTimersByTime(1000);});
  expect(screen.getByText('extracting')).toBeOnTheScreen();
  expect(enqueueJobSpec).not.toHaveBeenCalled();
  await view.unmount();
  const reads=jest.mocked(listJobSummaries).mock.calls.length;
  await act(async()=>{jest.advanceTimersByTime(3000);});
  expect(listJobSummaries).toHaveBeenCalledTimes(reads);
});
it('reports unavailable observation and recovers on the next poll',async()=>{
  await render(<Harness/>);
  jest.mocked(listJobSummaries).mockRejectedValueOnce(new Error('disconnected'));
  await act(async()=>{jest.advanceTimersByTime(1000);});
  expect(screen.getByText('unavailable')).toBeOnTheScreen();
  await act(async()=>{jest.advanceTimersByTime(1000);});
  expect(screen.getByText('downloading')).toBeOnTheScreen();
  expect(enqueueJobSpec).not.toHaveBeenCalled();
});
it('pauses observation while backgrounded and reconciles the same job on return',async()=>{
  let change: ((value:import('react-native').AppStateStatus)=>void) | undefined;
  const listener=jest.spyOn(AppState,'addEventListener').mockImplementation((_event,callback)=>{change=callback;return {remove:jest.fn()};});
  await render(<Harness/>);
  await act(async()=>{change?.('background');});
  const count=jest.mocked(listJobSummaries).mock.calls.length;
  await act(async()=>{jest.advanceTimersByTime(5000);});
  expect(listJobSummaries).toHaveBeenCalledTimes(count);
  jest.mocked(listJobSummaries).mockResolvedValue([{...job,setup:{phase:'installing_tools'}}]);
  await act(async()=>{change?.('active');});
  expect(screen.getByText('installing_tools')).toBeOnTheScreen();
  expect(reconcileJobs).toHaveBeenCalledTimes(2);
  expect(enqueueJobSpec).not.toHaveBeenCalled();
  listener.mockRestore();
});
it('does not begin observation if initial reconciliation finishes after unmount',async()=>{
  let finish: ((value:number)=>void) | undefined;
  jest.mocked(reconcileJobs).mockReturnValue(new Promise(resolve=>{finish=resolve;}));
  const view=await render(<Harness/>);await view.unmount();
  await act(async()=>{finish?.(0);});
  expect(listJobSummaries).not.toHaveBeenCalled();
});
