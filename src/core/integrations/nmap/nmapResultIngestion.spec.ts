import { readAsStringAsync } from 'expo-file-system/legacy';
import { ingestCompletedNmapJob } from './nmapResultIngestion';
import { parseNmapScanResult } from './nmapAdapter';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
import { ProjectRepository } from '@/core/storage/projectRepository';
import { ArtifactRepository } from '@/core/storage/artifactRepository';
import { ResultProcessingRepository } from '@/core/storage/resultProcessingRepository';
import { getJobSummary, markJobResultIngested } from '@/core/jobs/jobClient';
import { sha256FileUri } from '@/core/storage/artifactHash';
import type { JobSummary } from '@/core/models/job.model';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';

jest.mock('@/core/jobs/jobClient', () => ({getJobSummary: jest.fn(), markJobResultIngested: jest.fn()}));
jest.mock('@/core/storage/artifactHash', () => ({sha256FileUri: jest.fn()}));
jest.mock('./nmapAdapter', () => ({...jest.requireActual('./nmapAdapter'), parseNmapScanResult: jest.fn()}));
let db: SqlDatabase;
let summary: JobSummary;
beforeEach(() => {
  db = installTestAppStateDatabase();
  const project = new ProjectRepository(db).createProject({name: 'Parse recovery', description: '', notes: ''});
  summary = {id: 'scan', projectId: project.id, type: 'nmap.scan', providerId: 'provider.kali.nmap', capabilityId: 'network.service_detection', status: 'completed', artifactIds: ['xml'], operationId: 'op', observationsPending: true};
  new ArtifactRepository(db).register({id: 'xml', projectId: project.id, jobId: 'scan', type: 'nmap.xml', mimeType: 'application/xml', path: 'file:///retained.xml', hash: 'a'.repeat(64), size: 10, source: 'nmap'});
  jest.mocked(getJobSummary).mockResolvedValue(summary);
  jest.mocked(markJobResultIngested).mockResolvedValue(true);
  jest.mocked(sha256FileUri).mockResolvedValue('a'.repeat(64));
  jest.mocked(readAsStringAsync).mockResolvedValue('<nmaprun>');
  jest.mocked(parseNmapScanResult).mockReturnValue({status: 'truncated', detail: 'Truncated XML', observations: []});
});
afterEach(() => { resetTestAppStateDatabase(); jest.clearAllMocks(); });

it('retains malformed failures after restart, suppresses automatic retries and retries only identical bytes explicitly', async () => {
  expect(await ingestCompletedNmapJob(summary)).toMatchObject({ok: false, errorKey: 'PARSER_FAILED'});
  expect(new ResultProcessingRepository(db).get(summary.projectId, summary.id)).toMatchObject({state: 'failed', attemptCount: 1, artifactHash: 'a'.repeat(64)});
  await ingestCompletedNmapJob(summary);
  expect(parseNmapScanResult).toHaveBeenCalledTimes(1);
  expect(await ingestCompletedNmapJob(summary, {retry: true})).toMatchObject({ok: false, errorKey: 'PARSER_FAILED'});
  expect(parseNmapScanResult).toHaveBeenCalledTimes(2);
  expect(db.getAll('SELECT * FROM observations')).toHaveLength(0);
  expect(jest.mocked(markJobResultIngested).mock.calls.some(call => call[1] === 'observations:scan')).toBe(false);
});
it('serializes concurrent retries and commits a corrected parser result once', async () => {
  await ingestCompletedNmapJob(summary);
  jest.mocked(parseNmapScanResult).mockReturnValue({status: 'empty', observations: []});
  const results = await Promise.all([ingestCompletedNmapJob(summary, {retry: true}), ingestCompletedNmapJob(summary, {retry: true})]);
  expect(results.every(result => result.ok)).toBe(true);
  expect(db.getAll('SELECT * FROM result_ingestions')).toHaveLength(1);
  expect(new ResultProcessingRepository(db).get(summary.projectId, summary.id)).toMatchObject({state: 'succeeded', attemptCount: 2});
  await ingestCompletedNmapJob(summary);
  expect(parseNmapScanResult).toHaveBeenCalledTimes(2);
});
it('never parses cancelled partials or creates findings', async () => {
  summary.status = 'cancelled';
  expect(await ingestCompletedNmapJob(summary)).toMatchObject({artifactIngested: true, observationsIngested: false});
  expect(parseNmapScanResult).not.toHaveBeenCalled();
  expect(db.getAll('SELECT * FROM observations')).toHaveLength(0);
});
it('distinguishes changed artifact bytes from parser failure', async () => {
  jest.mocked(sha256FileUri).mockResolvedValue('b'.repeat(64));
  expect(await ingestCompletedNmapJob(summary)).toMatchObject({errorKey: 'ARTIFACT_INTEGRITY_FAILED'});
  expect(parseNmapScanResult).not.toHaveBeenCalled();
});
