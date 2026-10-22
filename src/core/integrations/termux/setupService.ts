import { probeSetup, probeKaliSetup } from './termuxBridgeClient';
import { enqueueJobSpec, getJobSummary, listJobSummaries, reconcileJobs } from '@/core/jobs/jobClient';
import type { JobSpec, JobSummary } from '@/core/models/job.model';
import { newEntityId } from '@/core/storage/ids';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';
import { isSkidErrorKey, type SkidErrorKey } from '@/core/security/errorKeys';

export interface SetupInspection {
  ok: boolean;
  pythonReady?: boolean;
  packageManagerReady?: boolean;
  architecture?: string;
  kaliReady?: boolean;
  toolsReady?: boolean;
  existingInstallation?: boolean;
  errorKey?: SkidErrorKey;
}
export type SetupKind = 'python' | 'nethunter';
export const SETUP_CATALOG = 'kali-2026.2-minimal-arm64-v1';

export function parseSetupInspection(raw: string): SetupInspection {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (!p || typeof p.ok !== 'boolean') throw new Error();
    for (const key of ['pythonReady', 'packageManagerReady', 'kaliReady', 'toolsReady', 'existingInstallation']) {
      if (p[key] !== undefined && typeof p[key] !== 'boolean') throw new Error();
    }
    if (p.errorKey !== undefined && !isSkidErrorKey(p.errorKey)) throw new Error();
    return p as unknown as SetupInspection;
  } catch { return {ok: false, errorKey: 'PARSER_FAILED'}; }
}
export async function inspectSetup(kind: SetupKind): Promise<SetupInspection> {
  return parseSetupInspection(await (kind === 'python' ? probeSetup() : probeKaliSetup()));
}
export function toSetupJobSpec(kind: SetupKind, id: string): JobSpec {
  return {id, projectId: SYSTEM_PROJECT_ID, type: `setup.${kind}`, capabilityId: 'workstation.setup', providerId: 'provider.termux.setup', parameters: {catalogId: SETUP_CATALOG}, timeoutMs: 7_200_000};
}
export async function activeSetupJob(kind: SetupKind) {
  return (await listJobSummaries(SYSTEM_PROJECT_ID, 100)).find(job => job.type === `setup.${kind}` && !['completed', 'failed', 'cancelled'].includes(job.status));
}

/** UI may detach; the native job and operation identity remain authoritative. */
export async function runSetupJob(kind: SetupKind, onProgress: (job: JobSummary) => void): Promise<{ok: boolean; errorKey?: SkidErrorKey; detail?: string}> {
  let job = await activeSetupJob(kind);
  if (job) await reconcileJobs();
  const id = job?.id ?? newEntityId(`setup-${kind}`);
  if (!job) {
    const queued = await enqueueJobSpec(toSetupJobSpec(kind, id));
    if (!queued.ok) return {ok: false, errorKey: isSkidErrorKey(queued.errorKey) ? queued.errorKey : 'JOB_FAILED'};
  }
  // A UI observation deadline does not cancel installation or resubmit it.
  const deadline = Date.now() + 7_200_000;
  while (Date.now() < deadline) {
    job = await getJobSummary(id) ?? undefined;
    if (job) {
      onProgress(job);
      if (job.status === 'completed') return {ok: true};
      if (job.status === 'failed' || job.status === 'cancelled') return {ok: false, errorKey: job.errorKey ?? 'SETUP_INTERRUPTED', detail: job.errorDetail};
      if (job.status === 'waiting_for_device') return {ok: false, errorKey: 'SETUP_INTERRUPTED', detail: 'Installation status needs checking. Open Termux, then return and continue the saved job.'};
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return {ok: false, errorKey: 'JOB_TIMEOUT', detail: 'The saved installation still needs checking. Return to Jobs before starting another install.'};
}
