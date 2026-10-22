import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { newEntityId } from '@/core/storage/ids';
import { databaseOperation, getHelperJobStatus, prepareDatabaseCredential } from '@/core/integrations/termux/termuxBridgeClient';
import { enqueueJobSpec, getJobSummary, reconcileJobs } from '@/core/jobs/jobClient';
import { ensureDeviceDatabasePassword, readDatabasePassword } from '@/core/security/databaseCredentials';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';
import type { DatabaseLifecycleRequest, DatabaseLifecycleResponse } from '@/core/models/databaseContracts.model';

export class TermuxLocalPostgreSqlClient {
  async invoke(request: DatabaseLifecycleRequest): Promise<DatabaseLifecycleResponse> {
    const failure = (errorKey: DatabaseLifecycleResponse['errorKey'], detail?: string) => ({...request, ok: false, errorKey, detail, completedAt: new Date().toISOString()}) as DatabaseLifecycleResponse;
    if (request.profileId !== 'termux-local') return failure('INVALID_PAYLOAD');
    if (request.operation === 'detect' || request.operation === 'health') {
      const password = await readDatabasePassword('termux-local');
      if (request.operation === 'health' && !password) return failure('DATABASE_CREDENTIALS_INVALID', 'Device database credential is missing. Recover it before reconnecting.');
      return databaseOperation(request, password ?? undefined);
    }
    if (request.operation === 'initialize') {
      const prepared = await prepareDatabaseCredential(request.operationId, await ensureDeviceDatabasePassword());
      if (!prepared.ok) return failure(prepared.errorKey, prepared.detail);
    }
    const preferences = new PreferencesRepository(openAppStateDatabase());
    const attemptKey = `database.attempt.${request.operationId}`;
    let id = preferences.getString(attemptKey) || request.operationId;
    let job = await getJobSummary(id);
    // Preserve the logical database operation across explicit retries and native attempts.
    // Older jobs used their native operation ID directly; retain it when resuming them.
    const databaseOperationId = preferences.getString(attemptKey + '.operation') || job?.operationId || request.operationId;
    preferences.setString(attemptKey + '.operation', databaseOperationId);
    if (job && ['failed', 'cancelled'].includes(job.status)) {
      id = newEntityId('db-attempt');
      preferences.setString(attemptKey, id);
      job = null;
    }
    if (!job) {
      const {operationId: _operationId, ...parameters} = request;
      const queued = await enqueueJobSpec({id, projectId: SYSTEM_PROJECT_ID, type: `database.${request.operation}`, capabilityId: 'metasploit.database', providerId: 'provider.termux.postgresql', parameters: {...parameters, databaseOperationId}, timeoutMs: 180_000});
      if (!queued.ok) return failure('JOB_FAILED', queued.detail);
    } else { await reconcileJobs(); }
    const deadline = Date.now() + 195_000;
    while (Date.now() < deadline) {
      job = await getJobSummary(id);
      if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) {
        const token = await getTermuxHelperToken();
        if (job.operationId && token) {
          const raw = await getHelperJobStatus(id, job.operationId, token);
          if (raw.payload) {
            const payload = JSON.parse(raw.payload) as {jobId?: string; operationId?: string; databaseResult?: DatabaseLifecycleResponse};
            const result = payload.databaseResult;
            if (payload.jobId === id && payload.operationId === job.operationId && result?.operationId === databaseOperationId && result.profileId === request.profileId && result.operation === request.operation) return {...result, operationId: request.operationId, jobId: id};
          }
        }
        return failure(job.errorKey ?? 'JOB_FAILED', job.status === 'cancelled' ? 'Operation cancelled. Inspect database health; a committed change is not rolled back by cancellation.' : 'Database operation failed. Inspect Jobs and recover the service.');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return failure('JOB_TIMEOUT', 'The durable operation remains in Jobs. Resume it without submitting a replacement.');
  }
}
