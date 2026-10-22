import { loadSystemStatusSnapshot, type SystemStatusSnapshot } from './systemStatusService';
import { currentEnvironmentSample, refreshEnvironmentSample } from './environmentSnapshot';
import { profileRevision } from '@/core/state/environmentProfile';
jest.mock('./systemStatusService', () => ({loadSystemStatusSnapshot: jest.fn()}));
jest.mock('@/core/state/environmentProfile', () => ({profileRevision: jest.fn(() => 0)}));
it('coalesces concurrent reads and rejects a late result from the previous profile', async () => {
  let finish!: (snapshot: SystemStatusSnapshot) => void;
  jest.mocked(loadSystemStatusSnapshot).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const first = refreshEnvironmentSample();
  expect(refreshEnvironmentSample()).toBe(first);
  jest.mocked(profileRevision).mockReturnValue(1);
  const assertion = expect(first).rejects.toThrow('Environment profile changed');
  finish({} as SystemStatusSnapshot);
  await assertion;
  expect(currentEnvironmentSample()).toBeUndefined();
});
