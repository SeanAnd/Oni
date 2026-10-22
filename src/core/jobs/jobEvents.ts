import type { JobEventType } from '@/core/models/jobEvents.model';

export interface StoredJobEvent {
  jobId: string;
  sequence: number;
  type: JobEventType;
  idempotencyKey: string;
  emittedAt: string;
  payload: Record<string, unknown>;
}

/** Returns false when the same idempotency key was already applied. */
export function applyEventIdempotent(
  seenKeys: Set<string>,
  event: StoredJobEvent,
): boolean {
  if (seenKeys.has(event.idempotencyKey)) {
    return false;
  }
  seenKeys.add(event.idempotencyKey);
  return true;
}

export function buildIdempotencyKey(jobId: string, kind: string): string {
  return `${jobId}:${kind}`;
}
