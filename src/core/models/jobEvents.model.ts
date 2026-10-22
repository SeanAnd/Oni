import type { JobStatus } from '@/core/models/job.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export const JOB_EVENT_TYPES = [
  'job.queued',
  'job.started',
  'job.progress',
  'job.stdout',
  'job.stderr',
  'job.waiting_for_device',
  'job.completed',
  'job.failed',
  'job.cancelled',
  'job.status_changed',
] as const;

export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

export function isJobEventType(value: unknown): value is JobEventType {
  return typeof value === 'string' && (JOB_EVENT_TYPES as readonly string[]).includes(value);
}

interface JobEventBase {
  type: JobEventType;
  jobId: string;
  sequence: number;
  emittedAt: string;
}

export interface JobQueuedEvent extends JobEventBase {
  type: 'job.queued';
}

export interface JobStartedEvent extends JobEventBase {
  type: 'job.started';
  backendExecutionId?: string;
}

export interface JobProgressEvent extends JobEventBase {
  type: 'job.progress';
  progress: number;
  message?: string;
}

export interface JobStreamEvent extends JobEventBase {
  type: 'job.stdout' | 'job.stderr';
  chunkRef: string;
  byteLength: number;
}

export interface JobWaitingForDeviceEvent extends JobEventBase {
  type: 'job.waiting_for_device';
  deviceHint?: string;
}

export interface JobCompletedEvent extends JobEventBase {
  type: 'job.completed';
  exitCode: number;
  artifactIds: string[];
}

export interface JobFailedEvent extends JobEventBase {
  type: 'job.failed';
  errorKey: SkidErrorKey;
  exitCode?: number | null;
  detail?: string;
}

export interface JobCancelledEvent extends JobEventBase {
  type: 'job.cancelled';
  reason?: string;
}

export interface JobStatusChangedEvent extends JobEventBase {
  type: 'job.status_changed';
  from: JobStatus;
  to: JobStatus;
}

export type JobEvent =
  | JobQueuedEvent
  | JobStartedEvent
  | JobProgressEvent
  | JobStreamEvent
  | JobWaitingForDeviceEvent
  | JobCompletedEvent
  | JobFailedEvent
  | JobCancelledEvent
  | JobStatusChangedEvent;
