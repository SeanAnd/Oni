import { TermuxLocalPostgreSqlClient } from './termuxLocalClient';
import { enqueueJobSpec, getJobSummary } from '@/core/jobs/jobClient';
import { getHelperJobStatus } from '@/core/integrations/termux/termuxBridgeClient';
import type { JobSummary } from '@/core/models/job.model';

jest.mock('@/core/storage/appStateDatabase', () => ({openAppStateDatabase: () => ({})}));
const mockValues = new Map<string, string>();
jest.mock('@/core/storage/preferencesRepository', () => ({PreferencesRepository: class {getString(key: string) {return mockValues.get(key) ?? null;} setString(key: string, value: string) {mockValues.set(key, value);}}}));
jest.mock('@/core/storage/ids', () => ({newEntityId: () => 'new-attempt'}));
jest.mock('@/core/jobs/jobClient', () => ({enqueueJobSpec: jest.fn(async () => ({ok: true})), getJobSummary: jest.fn(), reconcileJobs: jest.fn()}));
jest.mock('@/core/integrations/termux/termuxBridgeClient', () => ({getHelperJobStatus: jest.fn(), prepareDatabaseCredential: jest.fn(async () => ({ok: true}))}));
jest.mock('@/core/security/databaseCredentials', () => ({ensureDeviceDatabasePassword: jest.fn(async () => 'private-password')}));
jest.mock('@/core/security/termuxHelperToken', () => ({getTermuxHelperToken: jest.fn(async () => 'private-token')}));
beforeEach(() => {jest.clearAllMocks(); mockValues.clear();});
it('resumes an interrupted legacy restore with the same database operation and a new native attempt', async () => {
  jest.mocked(getJobSummary).mockResolvedValueOnce({id: 'original', status: 'failed', operationId: 'legacy-operation'} as JobSummary).mockResolvedValueOnce({id: 'new-attempt', status: 'completed', operationId: 'native-attempt-operation'} as JobSummary);
  jest.mocked(getHelperJobStatus).mockResolvedValue({ok: true, payload: JSON.stringify({jobId: 'new-attempt', operationId: 'native-attempt-operation', databaseResult: {ok: true, operation: 'restore', profileId: 'termux-local', operationId: 'legacy-operation'}})});
  const result = await new TermuxLocalPostgreSqlClient().invoke({operation: 'restore', profileId: 'termux-local', operationId: 'original', backupId: 'owned-backup', confirmReplace: true});
  expect(result.ok).toBe(true);
  expect(result.operationId).toBe('original');
  expect(result.jobId).toBe('new-attempt');
  expect(enqueueJobSpec).toHaveBeenCalledWith(expect.objectContaining({id: 'new-attempt', parameters: expect.objectContaining({databaseOperationId: 'legacy-operation', backupId: 'owned-backup', confirmReplace: true})}));
});
it('keeps credentials out of the native ledger while correlating new initialization', async () => {
  jest.mocked(getJobSummary).mockResolvedValueOnce(null).mockResolvedValueOnce({id: 'original', status: 'completed', operationId: 'native-operation'} as JobSummary);
  jest.mocked(getHelperJobStatus).mockResolvedValue({ok: true, payload: JSON.stringify({jobId: 'original', operationId: 'native-operation', databaseResult: {ok: true, operation: 'initialize', profileId: 'termux-local', operationId: 'original'}})});
  expect((await new TermuxLocalPostgreSqlClient().invoke({operation: 'initialize', profileId: 'termux-local', operationId: 'original'})).ok).toBe(true);
  expect(JSON.stringify(jest.mocked(enqueueJobSpec).mock.calls)).not.toContain('private-password');
  expect(jest.mocked(enqueueJobSpec).mock.calls[0][0].parameters.databaseOperationId).toBe('original');
});
