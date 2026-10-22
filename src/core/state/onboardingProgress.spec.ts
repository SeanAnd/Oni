import * as SecureStore from 'expo-secure-store';
import { readOnboardingProgress, readOnboardingProgressResult, recordSetupActivity, markOnboardingStepComplete } from './onboardingProgress';

jest.mock('expo-secure-store', () => ({getItemAsync:jest.fn(),setItemAsync:jest.fn()}));
const values = new Map<string,string>();
beforeEach(() => {
  jest.clearAllMocks();
  values.clear();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key,value) => {values.set(key,value);});
});
it('retains earlier task outcomes and start times after restart and later task writes', async () => {
  const first=await recordSetupActivity('termux','checking_python','termux-local');
  await recordSetupActivity('termux','installing_helper','termux-local');
  await markOnboardingStepComplete('termux','termux-local','Python was already available.');
  await recordSetupActivity('kali_health','installing_kali','termux-local');
  const restored=await readOnboardingProgress('termux-local');
  expect(restored.tasks?.termux?.startedAt).toBe(first.tasks?.termux?.startedAt);
  expect(restored.tasks?.termux?.finishedAt).toBeDefined();
  expect(restored.tasks?.termux?.outcome).toBe('Python was already available.');
  expect(restored.tasks?.kali_health?.activity).toBe('installing_kali');
  expect(restored.completedSteps).toContain('termux');
});
it('reads existing progress without inventing timings for historical tasks', async () => {
  values.set('skid.onboarding.progress.termux-local.v1',JSON.stringify({completedSteps:['termux'],onboardingComplete:false}));
  expect((await readOnboardingProgress('termux-local')).tasks).toEqual({});
});
it('distinguishes missing, malformed and inaccessible data without overwriting it', async () => {
  expect(await readOnboardingProgressResult('termux-local')).toMatchObject({status:'absent'});
  values.set('skid.onboarding.progress.termux-local.v1','not json');
  expect(await readOnboardingProgressResult('termux-local')).toEqual({status:'unavailable',reason:'malformed'});
  await expect(markOnboardingStepComplete('termux','termux-local')).rejects.toThrow('preserved');
  expect(values.get('skid.onboarding.progress.termux-local.v1')).toBe('not json');
  jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('locked'));
  expect(await readOnboardingProgressResult('termux-local')).toEqual({status:'unavailable',reason:'storage'});
});
it('filters unknown identifiers while preserving known checkpoints and task history', async () => {
  values.set('skid.onboarding.progress.termux-local.v1',JSON.stringify({completedSteps:['termux','profile','pairing','made-up',null],onboardingComplete:true}));
  expect(await readOnboardingProgressResult('termux-local')).toMatchObject({status:'found',progress:{completedSteps:['termux'],onboardingComplete:true}});
});
it('does not reuse or overwrite unscoped progress from a retired setup', async () => {
  const legacy = JSON.stringify({completedSteps:['termux','database_initialize','database_start'],onboardingComplete:true});
  values.set('skid.onboarding.progress', legacy);
  expect(await readOnboardingProgressResult('termux-local')).toMatchObject({status:'absent',progress:{completedSteps:[],onboardingComplete:false}});
  expect(values.get('skid.onboarding.progress')).toBe(legacy);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
});
