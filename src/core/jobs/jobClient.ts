import type { JobSpec, JobSummary } from '@/core/models/job.model';
import { validateJobSpecPayload } from '@/core/validators/boundaryPayload.validators';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import {
  cancelJobNative,
  configureTermuxHelperToken,
  enqueueJobNative,
  getJobNative,
  listJobsNative,
  markJobResultIngestedNative,
  reconcileJobsNative,
  subscribeJobUpdates,
  type JobUpdatedEvent,
} from '~/modules/jobs/src/index';

import { toKaliHealthJobSpec, type KaliHealthJobRequest } from '@/core/integrations/termux/kaliHealthJob';

export interface EnqueueJobResponse {
  ok: boolean;
  jobId?: string;
  errorKey?: string;
  detail?: string;
}

async function syncHelperTokenToNative(): Promise<void> {
  const token = await getTermuxHelperToken();
  await configureTermuxHelperToken(token);
}

/** Persist-first entry: native SQLite ledger owns job state; JS never writes a parallel table. */
export async function enqueueJobSpec(spec: JobSpec): Promise<EnqueueJobResponse> {
  const validated = validateJobSpecPayload(spec);
  if (!validated.ok) {
    return {
      ok: false,
      errorKey: 'INVALID_PAYLOAD',
      detail: validated.issues.join('; '),
    };
  }
  await syncHelperTokenToNative();
  return enqueueJobNative(JSON.stringify(validated.value));
}

export async function enqueueKaliHealthJob(request: KaliHealthJobRequest): Promise<EnqueueJobResponse> {
  return enqueueJobSpec(toKaliHealthJobSpec(request));
}

export async function cancelJob(jobId: string): Promise<boolean> {
  return cancelJobNative(jobId);
}

export async function getJobSummary(jobId: string): Promise<JobSummary | null> {
  return getJobNative(jobId);
}

export async function listJobSummaries(projectId?: string, limit = 50): Promise<JobSummary[]> {
  return listJobsNative(projectId ?? null, limit);
}

export async function reconcileJobs(): Promise<number> {
  await syncHelperTokenToNative();
  return reconcileJobsNative();
}

export async function markJobResultIngested(jobId: string, marker: string): Promise<boolean> {
  return markJobResultIngestedNative(jobId, marker);
}

export function watchJobUpdates(listener: (event: JobUpdatedEvent) => void) {
  return subscribeJobUpdates(listener);
}
