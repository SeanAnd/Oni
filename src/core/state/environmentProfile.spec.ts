import * as SecureStore from 'expo-secure-store';
import { holdProfile, readEnvironmentProfile, selectEnvironmentProfile } from './environmentProfile';
import { listJobSummaries } from '@/core/jobs/jobClient';
jest.mock('expo-secure-store', () => ({getItemAsync: jest.fn(), setItemAsync: jest.fn()}));
jest.mock('@/core/jobs/jobClient', () => ({listJobSummaries: jest.fn(async () => [])}));
const values = new Map<string, string>();
const key = 'skid.environment.profile.v1';
beforeEach(() => {
  values.clear();
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => {values.set(key, value);});
  jest.mocked(listJobSummaries).mockResolvedValue([]);
});
it('persists the device default for new installations', async () => {
  expect(await readEnvironmentProfile()).toBe('termux-local');
  expect(values.get(key)).toBe('termux-local');
});
it.each(['retired-profile', 'termux-local'])('retains credentials and scoped progress when retiring selection: %s', async profile => {
  values.set(key, profile);
  values.set('retired.helper_token', 'legacy');
  values.set('skid.onboarding.progress', 'host-progress');
  values.set('skid.onboarding.progress.termux-local.v1', 'device-progress');
  expect(await readEnvironmentProfile()).toBe('termux-local');
  expect(values.get('retired.helper_token')).toBe('legacy');
  expect(values.get('skid.onboarding.progress')).toBe('host-progress');
  expect(values.get('skid.onboarding.progress.termux-local.v1')).toBe('device-progress');
  const writes = jest.mocked(SecureStore.setItemAsync).mock.calls.length;
  await readEnvironmentProfile();
  expect(jest.mocked(SecureStore.setItemAsync).mock.calls).toHaveLength(writes);
});
it('does not permit selecting a retired host profile', async () => {
  await expect(selectEnvironmentProfile('retired-profile' as Parameters<typeof selectEnvironmentProfile>[0])).rejects.toThrow('INVALID_PAYLOAD');
});
it('does not claim migration success after a storage failure and safely resumes', async () => {
  values.set(key, 'retired-profile');
  jest.mocked(SecureStore.setItemAsync).mockImplementationOnce(async (key,value) => { values.set(key,value); }).mockRejectedValueOnce(new Error('locked'));
  await expect(readEnvironmentProfile()).rejects.toThrow('locked');
  expect(values.get(key)).toBe('retired-profile');
  expect(await readEnvironmentProfile()).toBe('termux-local');
  expect(JSON.parse(values.get('oni.environment.device-only.v1')!).previous).toBe('retired-profile');
});
it('blocks migration during held work or an unresolved device maintenance job', async () => {
  const release = holdProfile();
  await expect(readEnvironmentProfile()).rejects.toThrow('DATABASE_BUSY'); release();
  jest.mocked(listJobSummaries).mockResolvedValue([{type: 'database.restore', providerId: 'provider.termux.postgresql', status: 'running'} as Awaited<ReturnType<typeof listJobSummaries>>[number]]);
  await expect(readEnvironmentProfile()).rejects.toThrow('DATABASE_BUSY');
  expect(values.has(key)).toBe(false);
});
