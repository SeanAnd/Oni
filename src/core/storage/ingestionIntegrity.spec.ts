import { createNodeSqlDatabase } from './sqlDatabase.node';
import { runAppStateMigrations } from './migrationRunner';
import { ProjectRepository } from './projectRepository';
import { JobResultIngestionService } from './jobResultIngestion';
import { TargetRepository } from './targetRepository';
import { ObservationRepository } from './observationRepository';
import { ArtifactRepository } from './artifactRepository';
import { getJobSummary, markJobResultIngested } from '@/core/jobs/jobClient';
import { downloadAndFinalizeArtifact } from './artifactDownloader';

jest.mock('@/core/jobs/jobClient', () => ({getJobSummary: jest.fn(), markJobResultIngested: jest.fn()}));
jest.mock('./artifactDownloader', () => ({downloadAndFinalizeArtifact: jest.fn()}));
const getJob = jest.mocked(getJobSummary);
const mark = jest.mocked(markJobResultIngested);

function setup() {
  const db = createNodeSqlDatabase();
  runAppStateMigrations(db);
  const project = new ProjectRepository(db).createProject({name: 'Alpha', description: ''});
  getJob.mockResolvedValue({id: 'job-1', projectId: project.id, operationId: 'op-1', status: 'completed', type: 'nmap.scan', capabilityId: 'network.service_detection', providerId: 'provider.kali.nmap', artifactIds: ['artifact-1']});
  mark.mockResolvedValue(true);
  return {db, project, ingestion: new JobResultIngestionService(db)};
}

afterEach(() => jest.resetAllMocks());

it('commits findings, target links and a durable marker once across concurrent retries', async () => {
  const {db, project, ingestion} = setup();
  const request = {projectId: project.id, jobId: 'job-1', observations: [{type: 'network.host', source: 'nmap', data: {address: '127.0.0.1'}}]};
  await Promise.all([ingestion.ingestObservations(request), ingestion.ingestObservations(request)]);
  expect(new ObservationRepository(db).countForJob(project.id, 'job-1')).toBe(1);
  expect(new TargetRepository(db).listByProject(project.id)).toHaveLength(1);
  expect(db.getAll('SELECT * FROM result_ingestions')).toHaveLength(1);
  db.close();
});

it('recovers after native acknowledgement fails without duplicating observations', async () => {
  const {db, project, ingestion} = setup();
  mark.mockRejectedValueOnce(new Error('UI detached'));
  const request = {projectId: project.id, jobId: 'job-1', observations: [{type: 'network.host', source: 'nmap', data: {address: '127.0.0.1'}}]};
  await expect(ingestion.ingestObservations(request)).rejects.toThrow('UI detached');
  await new JobResultIngestionService(db).ingestObservations(request);
  expect(new ObservationRepository(db).countForProject(project.id)).toBe(1);
  db.close();
});

it('records an empty result durably and clears native pending state', async () => {
  const {db, project, ingestion} = setup();
  await ingestion.ingestObservations({projectId: project.id, jobId: 'job-1', observations: []});
  expect(db.getAll('SELECT * FROM result_ingestions')).toHaveLength(1);
  expect(mark).toHaveBeenCalledWith('job-1', 'observations:job-1');
  db.close();
});

it('keeps a rejected native acknowledgement retryable without reinserting committed findings', async () => {
  const {db, project, ingestion} = setup();
  mark.mockResolvedValueOnce(false);
  const request = {projectId: project.id, jobId: 'job-1', observations: []};
  expect(await ingestion.ingestObservations(request)).toMatchObject({ok: false});
  expect(await ingestion.ingestObservations(request)).toEqual({ok: true});
  expect(db.getAll('SELECT * FROM result_ingestions')).toHaveLength(1);
  db.close();
});

it('registers verified bytes once and retries native acknowledgement without downloading again', async () => {
  const {db, project, ingestion} = setup();
  jest.mocked(downloadAndFinalizeArtifact).mockResolvedValue({ok: true, size: 10, hash: 'a'.repeat(64)});
  mark.mockRejectedValueOnce(new Error('detached'));
  const request = {projectId: project.id, jobId: 'job-1', artifactId: 'artifact-1', operationId: 'op-1', type: 'nmap.xml', mimeType: 'application/xml', source: 'nmap'};
  await expect(ingestion.ingestArtifact(request)).rejects.toThrow('detached');
  expect(await ingestion.ingestArtifact(request)).toEqual({ok: true});
  expect(downloadAndFinalizeArtifact).toHaveBeenCalledTimes(1);
  expect(new ArtifactRepository(db).listByJob(project.id, 'job-1')).toHaveLength(1);
  expect(db.getAll("SELECT * FROM audit_entries WHERE action = 'artifact.registered'")).toHaveLength(1);
  db.close();
});

it('does not register or acknowledge artifacts that fail integrity verification', async () => {
  const {db, project, ingestion} = setup();
  jest.mocked(downloadAndFinalizeArtifact).mockResolvedValue({ok: false, size: 0, errorKey: 'PARSER_FAILED'});
  expect(await ingestion.ingestArtifact({projectId: project.id, jobId: 'job-1', artifactId: 'artifact-1', operationId: 'op-1', type: 'nmap.xml', mimeType: 'application/xml', source: 'nmap'})).toMatchObject({ok: false});
  expect(new ArtifactRepository(db).listByProject(project.id)).toHaveLength(0);
  expect(mark).not.toHaveBeenCalled();
  db.close();
});

it.each(['foreign-operation', ''])('rejects uncorrelated artifact operation %p before download', async (operationId) => {
  const {db, project, ingestion} = setup();
  expect(await ingestion.ingestArtifact({projectId: project.id, jobId: 'job-1', artifactId: 'artifact-1', operationId, type: 'nmap.xml', mimeType: 'application/xml', source: 'nmap'})).toMatchObject({ok: false});
  expect(downloadAndFinalizeArtifact).not.toHaveBeenCalled();
  db.close();
});

it('rejects another project’s job and artifact before touching the filesystem', async () => {
  const {db, ingestion} = setup();
  const beta = new ProjectRepository(db).createProject({name: 'Beta', description: ''});
  expect(await ingestion.ingestObservations({projectId: beta.id, jobId: 'job-1', observations: []})).toMatchObject({ok: false});
  expect(await ingestion.ingestArtifact({projectId: beta.id, jobId: 'job-1', artifactId: 'artifact-1', operationId: 'op-1', type: 'nmap.xml', mimeType: 'application/xml', source: 'nmap'})).toMatchObject({ok: false});
  expect(mark).not.toHaveBeenCalled();
  db.close();
});

it('rolls back all findings and target creation when a later observation has foreign ownership', async () => {
  const {db, project, ingestion} = setup();
  await expect(ingestion.ingestObservations({projectId: project.id, jobId: 'job-1', observations: [
    {type: 'network.host', source: 'nmap', data: {address: '127.0.0.1'}},
    {type: 'network.host', source: 'nmap', jobId: 'foreign', data: {}},
  ]})).rejects.toThrow('PROJECT_OWNERSHIP_DENIED');
  expect(db.getAll('SELECT * FROM targets')).toHaveLength(0);
  expect(db.getAll('SELECT * FROM result_ingestions')).toHaveLength(0);
  db.close();
});

it('enforces foreign keys and project scoping in SQLite itself', () => {
  const {db, project} = setup();
  const beta = new ProjectRepository(db).createProject({name: 'Beta', description: ''});
  const target = new TargetRepository(db).createTarget({projectId: beta.id, label: '', address: '10.0.0.1'});
  expect(() => new ObservationRepository(db).insertMany(project.id, 'job', [{type: 'network.host', source: 'nmap', targetId: target.id, data: {}}])).toThrow('PROJECT_OWNERSHIP_DENIED');
  expect(() => new TargetRepository(db).createTarget({projectId: 'missing', label: '', address: 'x'})).toThrow();
  expect(() => new ArtifactRepository(db).register({id: 'a', projectId: project.id, type: 'xml', mimeType: 'application/xml', path: '/a', size: -1, hash: 'wrong', source: 'nmap'})).toThrow();
  db.close();
});

it('rolls back DDL if recording a migration fails', () => {
  const {db} = setup();
  db.exec("CREATE TRIGGER block_record BEFORE INSERT ON app_migrations BEGIN SELECT RAISE(ABORT, 'disk error'); END;");
  const {APP_STATE_MIGRATIONS} = jest.requireActual('./migrations/manifest');
  expect(() => runAppStateMigrations(db, {migrations: [...APP_STATE_MIGRATIONS, {filename: '0004_failure.sql', sql: 'CREATE TABLE should_not_exist (id TEXT);', sha256: 'a'.repeat(64)}]})).toThrow();
  expect(db.getFirst("SELECT name FROM sqlite_master WHERE name = 'should_not_exist'")).toBeNull();
  db.close();
});
