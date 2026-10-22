import type { JobStatus } from '@/core/models/job.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

const LEGAL_TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ['starting', 'cancelled'],
  starting: ['running', 'waiting_for_device', 'failed', 'cancelled'],
  running: ['completed', 'failed', 'cancelled', 'waiting_for_device'],
  waiting_for_device: ['running', 'failed', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: [],
};

export const TERMINAL_JOB_STATUSES: readonly JobStatus[] = ['completed', 'failed', 'cancelled'];

export function isTerminalJobStatus(status: JobStatus): boolean {
  return (TERMINAL_JOB_STATUSES as readonly string[]).includes(status);
}

export function canTransitionJobStatus(from: JobStatus, to: JobStatus): boolean {
  if (from === to) {
    return true;
  }
  if (isTerminalJobStatus(from)) {
    return false;
  }
  return LEGAL_TRANSITIONS[from].includes(to);
}

export class IllegalJobTransitionError extends Error {
  readonly errorKey: SkidErrorKey = 'JOB_ILLEGAL_TRANSITION';

  constructor(
    readonly from: JobStatus,
    readonly to: JobStatus,
  ) {
    super(`Illegal job transition from ${from} to ${to}`);
    this.name = 'IllegalJobTransitionError';
  }
}

export function assertJobTransition(from: JobStatus, to: JobStatus): void {
  if (!canTransitionJobStatus(from, to)) {
    throw new IllegalJobTransitionError(from, to);
  }
}

export function nextStatusesFrom(from: JobStatus): readonly JobStatus[] {
  return LEGAL_TRANSITIONS[from];
}
