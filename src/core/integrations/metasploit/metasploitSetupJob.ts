import { enqueueJobSpec, getJobSummary, reconcileJobs } from '@/core/jobs/jobClient';
import { getHelperJobStatus, type MetasploitScriptResult } from '@/core/integrations/termux/termuxBridgeClient';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { holdProfile, readEnvironmentProfile } from '@/core/state/environmentProfile';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { newEntityId } from '@/core/storage/ids';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';

/** Framework initializes its own schema during supported console startup, then checks its APIs. */
export async function prepareMetasploitSchema(): Promise<MetasploitScriptResult> {
  await readEnvironmentProfile();
  const release = holdProfile();
  try {
    const profileId = await readEnvironmentProfile();
    const preferences = new PreferencesRepository(openAppStateDatabase());
    const key = `metasploit.pending.${profileId}.schema`;
    const id = preferences.getString(key) || newEntityId('msf-schema');
    preferences.setString(key, id);
    if (!await getJobSummary(id)) {
      const queued = await enqueueJobSpec({id, projectId: SYSTEM_PROJECT_ID, type: 'metasploit.prepare', capabilityId: 'metasploit.database', providerId: 'provider.kali.metasploit', parameters: {profileId}, timeoutMs: 180000});
      if (!queued.ok) return {ok: false, errorKey: 'JOB_FAILED', detail: queued.detail};
    } else await reconcileJobs();
    const deadline = Date.now() + 190000;
    while (Date.now() < deadline) {
      const job = await getJobSummary(id);
      if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) {
        preferences.setString(key, '');
        const token = await getTermuxHelperToken();
        if (job.operationId && token) {
          const response = await getHelperJobStatus(id, job.operationId, token);
          const payload = JSON.parse(response.payload ?? '{}') as {jobId?: string; operationId?: string; databaseResult?: MetasploitScriptResult};
          if (payload.jobId === id && payload.operationId === job.operationId && payload.databaseResult) return payload.databaseResult;
        }
        return {ok: false, errorKey: job.errorKey ?? 'JOB_FAILED'};
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return {ok: false, errorKey: 'JOB_TIMEOUT', detail: 'Schema job is still pending. Inspect Jobs and resume setup.'};
  } finally { release(); }
}
