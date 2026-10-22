import type { JobStatus } from '@/core/models/job.model';
import { isTerminalJobStatus } from '@/core/jobs/transitions';

export interface HelperJobStatusPayload {
  status?: string;
  exitCode?: number | null;
  artifactIds?: string[];
  errorKey?: string;
  detail?: string;
}

export interface RunCommandEnvelope {
  ok?: boolean;
  exitCode?: number | null;
  artifactIds?: string[];
  observationsPending?: boolean;
  errorKey?: string;
  detail?: string;
}

export type ReconcileDecision =
  | { action: 'noop'; reason: 'already_terminal' | 'unknown_helper_status' }
  | { action: 'complete'; exitCode: number; artifactIds: string[]; observationsPending: boolean }
  | { action: 'fail'; errorKey: string; exitCode?: number | null; detail?: string }
  | { action: 'cancel'; reason?: string }
  | { action: 'apply_envelope'; envelope: RunCommandEnvelope };

/** Pure reconciliation used by tests; native execution mirrors these rules. */
export function reconcileTerminalFromHelper(
  currentStatus: JobStatus,
  helper: HelperJobStatusPayload,
  envelope?: RunCommandEnvelope,
): ReconcileDecision {
  if (isTerminalJobStatus(currentStatus)) {
    return { action: 'noop', reason: 'already_terminal' };
  }

  const helperStatus = helper.status?.toLowerCase();
  switch (helperStatus) {
    case 'completed':
      return {
        action: 'complete',
        exitCode: helper.exitCode ?? 0,
        artifactIds: helper.artifactIds ?? [],
        observationsPending: true,
      };
    case 'failed':
      return {
        action: 'fail',
        errorKey: helper.errorKey ?? 'TOOL_NOT_FOUND',
        exitCode: helper.exitCode ?? null,
        detail: helper.detail,
      };
    case 'cancelled':
      return { action: 'cancel', reason: 'helper_cancelled' };
    default:
      break;
  }

  if (envelope) {
    return { action: 'apply_envelope', envelope };
  }
  return { action: 'noop', reason: 'unknown_helper_status' };
}

/** Cancel must not overwrite an earlier terminal completion. */
export function shouldApplyCancel(currentStatus: JobStatus): boolean {
  return !isTerminalJobStatus(currentStatus);
}
