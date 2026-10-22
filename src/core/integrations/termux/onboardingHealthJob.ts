import { enqueueKaliHealthJob, getJobSummary } from '@/core/jobs/jobClient';
import type { SkidErrorKey } from '@/core/security/errorKeys';

/** Onboarding advances only after the durable job reports a successful result. */
export async function runOnboardingHealthJob(id: string, projectId: string): Promise<{ok: boolean; errorKey?: SkidErrorKey; detail?: string}> {
  const queued = await enqueueKaliHealthJob({id, projectId});
  if (!queued.ok) return {ok: false, errorKey: (queued.errorKey as SkidErrorKey) ?? 'JOB_FAILED'};
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const job = await getJobSummary(id);
    if (job?.status === 'completed') return {ok: true};
    if (job && ['failed', 'cancelled'].includes(job.status)) return {ok: false, errorKey: job.errorKey ?? 'JOB_FAILED'};
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return {ok: false, errorKey: 'JOB_TIMEOUT', detail: 'Health result is still pending. Inspect Jobs before retrying.'};
}
