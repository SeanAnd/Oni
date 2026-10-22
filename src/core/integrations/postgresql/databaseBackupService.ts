import { getJobSummary } from '@/core/jobs/jobClient';
import { JobResultIngestionService } from '@/core/storage/jobResultIngestion';
import { ArtifactRepository } from '@/core/storage/artifactRepository';
import { ProjectRepository } from '@/core/storage/projectRepository';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';
import { MAX_ARTIFACT_BYTES } from '@/core/storage/artifactDownloader';
import { sha256FileUri } from '@/core/storage/artifactHash';
import { StorageAccessFramework, readAsStringAsync, writeAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { invokeDatabaseLifecycle } from './databaseLifecycleService';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';

const KEY = 'database.termux-local.latestBackup';
export function latestManagedBackup(): string | null { return new PreferencesRepository(openAppStateDatabase()).getString(KEY); }
export async function backupManagedDatabase() {
  const result = await invokeDatabaseLifecycle('backup');
  if (result.ok && result.operation === 'backup' && result.backupId) {
    const preferences = new PreferencesRepository(openAppStateDatabase());
    preferences.setString(KEY, result.backupId);
    preferences.setString(KEY + '.job', result.jobId ?? result.operationId);
  }
  return result;
}
export async function restoreManagedDatabase(backupId: string) {
  const result = await invokeDatabaseLifecycle('restore', {backupId, confirmReplace: true});
  if (result.ok && result.operation === 'restore' && result.rollbackId) new PreferencesRepository(openAppStateDatabase()).setString(KEY + '.rollback', result.rollbackId);
  return result;
}

export function latestManagedRollback(): string | null { return new PreferencesRepository(openAppStateDatabase()).getString(KEY + '.rollback'); }
export async function rollbackManagedDatabase(rollbackId: string) {
  const result = await invokeDatabaseLifecycle('rollback', {rollbackId, confirmReplace: true});
  if (result.ok) new PreferencesRepository(openAppStateDatabase()).setString(KEY + '.rollback', '');
  return result;
}

/** Export only the verified archive owned by the completed backup job. */
export async function exportLatestManagedBackup(): Promise<{ok: boolean; detail: string}> {
  const db = openAppStateDatabase();
  const preferences = new PreferencesRepository(db);
  const id = preferences.getString(KEY + '.job');
  const job = id ? await getJobSummary(id) : null;
  if (!job || job.status !== 'completed' || job.type !== 'database.backup' || job.projectId !== SYSTEM_PROJECT_ID || !job.operationId || !job.artifactIds[0]) return {ok: false, detail: 'Create a completed managed backup before exporting.'};
  new ProjectRepository(db).ensureSystemProject();
  const artifactId = job.artifactIds[0];
  const ingested = await new JobResultIngestionService(db).ingestArtifact({projectId: SYSTEM_PROJECT_ID, jobId: job.id, operationId: job.operationId, artifactId, type: 'postgresql.backup', mimeType: 'application/octet-stream', subdir: 'exports', fileName: `${artifactId}.dump`, source: 'postgresql'});
  if (!ingested.ok) return {ok: false, detail: `Export transfer failed. The private backup is retained. App export is limited to ${MAX_ARTIFACT_BYTES / 1024 / 1024} MiB to bound memory.`};
  const artifact = new ArtifactRepository(db).getById(SYSTEM_PROJECT_ID, artifactId);
  if (!artifact || artifact.size > MAX_ARTIFACT_BYTES || await sha256FileUri(artifact.path) !== artifact.hash) return {ok: false, detail: 'Backup integrity verification failed. No file was exported.'};
  const permission = await StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return {ok: false, detail: 'Export cancelled; the private backup is retained.'};
  const destination = await StorageAccessFramework.createFileAsync(permission.directoryUri, `${latestManagedBackup()}.dump`, 'application/octet-stream');
  await writeAsStringAsync(destination, await readAsStringAsync(artifact.path, {encoding: EncodingType.Base64}), {encoding: EncodingType.Base64});
  return {ok: true, detail: `Backup exported. SHA-256: ${artifact.hash}`};
}
