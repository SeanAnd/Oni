import { SETUP_TASKS } from '@/core/models/setupTask.model';
import { projectSetupReadiness, setupAccess } from '@/core/models/setupReadiness.model';
import { createSetupReadinessStore, setupReadiness } from './setupReadiness';
import { writeOnboardingProgress, type OnboardingReadResult } from './onboardingProgress';

const complete: OnboardingReadResult = {status:'found',progress:{completedSteps:[...SETUP_TASKS],onboardingComplete:false}};
it('requires all six distinct checkpoints and ignores the legacy completion flag', () => {
  expect(projectSetupReadiness({status:'absent',progress:{completedSteps:[],onboardingComplete:false}})).toMatchObject({status:'incomplete',completed:0,required:6,nextTask:'termux'});
  expect(projectSetupReadiness({status:'found',progress:{completedSteps:['termux','termux','complete'],onboardingComplete:true}})).toMatchObject({status:'incomplete',completed:1,nextTask:'kali_health'});
  expect(projectSetupReadiness(complete)).toMatchObject({status:'complete',completed:6});
  expect(setupAccess({status:'loading'})).toMatchObject({allowed:false,errorKey:'SETUP_STATUS_UNAVAILABLE'});
  expect(setupAccess({status:'unavailable'})).toMatchObject({allowed:false,errorKey:'SETUP_STATUS_UNAVAILABLE'});
});
it('coalesces concurrent reads and discards a read superseded by a write', async () => {
  let finish!: (result: OnboardingReadResult) => void;
  const read = jest.fn().mockImplementationOnce(() => new Promise(resolve => {finish=resolve;})).mockResolvedValue(complete);
  const store = createSetupReadinessStore(read);
  const listener = jest.fn(); const unsubscribe = store.subscribe(listener);
  const first = store.refresh();
  expect(store.refresh()).toBe(first);
  void store.invalidate();
  finish({status:'absent',progress:{completedSteps:[],onboardingComplete:false}});
  await expect(first).resolves.toMatchObject({status:'complete'});
  expect(read).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});
it('publishes unavailable after rejected storage reads', async () => {
  const store=createSetupReadinessStore(async () => { throw new Error('locked'); });
  await expect(store.refresh()).resolves.toEqual({status:'unavailable'});
});
it('refreshes mounted subscribers after successful progress writes', async () => {
  const listener=jest.fn(); const unsubscribe=setupReadiness.subscribe(listener);
  await writeOnboardingProgress({completedSteps:[...SETUP_TASKS],onboardingComplete:false},'termux-local');
  await setupReadiness.refresh();
  expect(setupReadiness.getSnapshot()).toMatchObject({status:'complete'});
  expect(listener).toHaveBeenCalled();
  unsubscribe();
});

jest.mock('expo-secure-store', () => {
  const values = new Map<string,string>();
  return {getItemAsync:jest.fn(async (key:string) => values.get(key) ?? null),setItemAsync:jest.fn(async (key:string,value:string) => {values.set(key,value);})};
});
