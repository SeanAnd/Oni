import type { JobResult } from '@/core/models/job.model';
import {
  validateJobSpecPayload,
  type ValidatedJobSpecPayload,
} from '@/core/validators/boundaryPayload.validators';

import { runKaliHealth, runStructuredJob } from '@/core/integrations/termux/termuxBridgeClient';

export const KALI_HEALTH_JOB_TYPE = 'workstation.kali_health';
export const KALI_HEALTH_CAPABILITY = 'workstation.health' as const;
export const KALI_HEALTH_PROVIDER = 'provider.kali.health' as const;

export interface KaliHealthJobRequest {
  id: string;
  projectId: string;
  timeoutMs?: number;
}

export function toKaliHealthJobSpec(request: KaliHealthJobRequest) {
  return {
    id: request.id,
    projectId: request.projectId,
    type: KALI_HEALTH_JOB_TYPE,
    capabilityId: KALI_HEALTH_CAPABILITY,
    providerId: KALI_HEALTH_PROVIDER,
    parameters: { probe: 'kali_health' },
    timeoutMs: request.timeoutMs ?? 120_000,
  };
}

/** Executes the fixed Kali health probe through the production native job path. */
export async function executeKaliHealthJob(request: KaliHealthJobRequest): Promise<JobResult> {
  const spec = toKaliHealthJobSpec(request);
  const validated = validateJobSpecPayload(spec);
  if (!validated.ok) {
    return {
      jobId: request.id,
      exitCode: null,
      artifactIds: [],
      observationsPending: false,
      errorKey: 'INVALID_PAYLOAD',
      errorDetail: validated.issues.join('; '),
    };
  }

  const health = await runKaliHealth(validated.value.timeoutMs);
  if (!health.ok) {
    return {
      jobId: request.id,
      exitCode: 1,
      artifactIds: [],
      observationsPending: false,
      errorKey: health.errorKey ?? 'NETHUNTER_NOT_FOUND',
      errorDetail: health.detail,
    };
  }

  return {
    jobId: request.id,
    exitCode: 0,
    artifactIds: [],
    observationsPending: false,
  };
}

/** Structured execution entry used by future durable jobs for non-health tools. */
export async function executeStructuredJobFromSpec(spec: ValidatedJobSpecPayload): Promise<JobResult> {
  if (!spec.command) {
    return {
      jobId: spec.id,
      exitCode: null,
      artifactIds: [],
      observationsPending: false,
      errorKey: 'INVALID_PAYLOAD',
      errorDetail: 'command is required for structured execution.',
    };
  }

  const nativeResult = await runStructuredJob({
    jobId: spec.id,
    projectId: spec.projectId,
    timeoutMs: spec.timeoutMs,
    command: spec.command,
  });

  return {
    jobId: nativeResult.jobId,
    exitCode: nativeResult.exitCode ?? null,
    artifactIds: nativeResult.artifactIds,
    observationsPending: nativeResult.observationsPending,
    errorKey: nativeResult.errorKey,
    errorDetail: nativeResult.detail,
  };
}
