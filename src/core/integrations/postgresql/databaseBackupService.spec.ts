import { exportLatestManagedBackup } from './databaseBackupService';
import { getJobSummary } from '@/core/jobs/jobClient';
import { sha256FileUri } from '@/core/storage/artifactHash';
import { StorageAccessFramework, writeAsStringAsync } from 'expo-file-system/legacy';

jest.mock('./databaseLifecycleService', () => ({invokeDatabaseLifecycle: jest.fn()}));
jest.mock('@/core/jobs/jobClient', () => ({getJobSummary: jest.fn()}));
jest.mock('@/core/storage/appStateDatabase', () => ({openAppStateDatabase: () => ({})}));
jest.mock('@/core/storage/preferencesRepository', () => ({PreferencesRepository: class {getString() {return 'backup-job';}}}));
jest.mock('@/core/storage/projectRepository', () => ({ProjectRepository: class {ensureSystemProject() {}}}));
jest.mock('@/core/storage/jobResultIngestion', () => ({JobResultIngestionService: class {async ingestArtifact() {return {ok: true};}}}));
jest.mock('@/core/storage/artifactRepository', () => ({ArtifactRepository: class {getById() {return {size: 128, hash: 'verified-hash', path: 'file:///private/backup.dump'};}}}));
jest.mock('@/core/storage/artifactHash', () => ({sha256FileUri: jest.fn()}));
jest.mock('expo-file-system/legacy', () => ({EncodingType: {Base64: 'base64'}, readAsStringAsync: jest.fn(async () => 'ZHVtcA=='), writeAsStringAsync: jest.fn(), StorageAccessFramework: {requestDirectoryPermissionsAsync: jest.fn(), createFileAsync: jest.fn(async () => 'content://selected/backup.dump')}}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getJobSummary).mockResolvedValue({id: 'backup-job', projectId: 'system-onboarding', type: 'database.backup', status: 'completed', operationId: 'operation', artifactIds: ['artifact']} as Awaited<ReturnType<typeof getJobSummary>>);
  jest.mocked(sha256FileUri).mockResolvedValue('verified-hash');
});
it('rejects another project before asking for an export location', async () => {
  jest.mocked(getJobSummary).mockResolvedValue({projectId: 'another-project'} as Awaited<ReturnType<typeof getJobSummary>>);
  expect((await exportLatestManagedBackup()).ok).toBe(false);
  expect(StorageAccessFramework.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
});
it('rejects modified private bytes before opening the picker', async () => {
  jest.mocked(sha256FileUri).mockResolvedValue('changed');
  expect((await exportLatestManagedBackup()).ok).toBe(false);
  expect(StorageAccessFramework.requestDirectoryPermissionsAsync).not.toHaveBeenCalled();
});
it('preserves the private backup when the user cancels export', async () => {
  jest.mocked(StorageAccessFramework.requestDirectoryPermissionsAsync).mockResolvedValue({granted: false});
  expect((await exportLatestManagedBackup()).ok).toBe(false);
  expect(writeAsStringAsync).not.toHaveBeenCalled();
});
it('writes only verified bytes to the user-selected destination', async () => {
  jest.mocked(StorageAccessFramework.requestDirectoryPermissionsAsync).mockResolvedValue({granted: true, directoryUri: 'content://selected'});
  expect((await exportLatestManagedBackup()).ok).toBe(true);
  expect(writeAsStringAsync).toHaveBeenCalledWith('content://selected/backup.dump', 'ZHVtcA==', {encoding: 'base64'});
});
