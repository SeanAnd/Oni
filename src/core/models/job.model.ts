import type { CapabilityId } from '@/core/capabilities/capabilityIds';
import type { ProviderId } from '@/core/capabilities/providerIds';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export const JOB_STATUSES = [
  'queued',
  'starting',
  'running',
  'waiting_for_device',
  'completed',
  'failed',
  'cancelled',
] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === 'string' && (JOB_STATUSES as readonly string[]).includes(value);
}

/** Structured tool invocation; argument arrays only — no shell interpolation. */
export interface StructuredCommand {
  binary: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface JobSpec {
  id: string;
  projectId: string;
  type: string;
  capabilityId: CapabilityId;
  providerId: ProviderId;
  parameters: Record<string, unknown>;
  command?: StructuredCommand;
  timeoutMs?: number;
  artifactOutputPaths?: string[];
}

export interface JobResult {
  jobId: string;
  exitCode: number | null;
  stdoutRef?: string;
  stderrRef?: string;
  artifactIds: string[];
  observationsPending: boolean;
  errorKey?: SkidErrorKey;
  errorDetail?: string;
}

export interface SetupJobProgress {
  phase: string;
  elapsedSeconds?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  cancelDeferred?: boolean;
}

export interface JobSummary {
  setup?: SetupJobProgress;
  errorDetail?: string;
  processing?: import('@/core/storage/resultProcessingRepository').ResultProcessingSummary;
  id: string;
  projectId: string;
  type: string;
  capabilityId: CapabilityId;
  providerId: ProviderId;
  status: JobStatus;
  progress?: number;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number | null;
  errorKey?: SkidErrorKey;
  artifactIds: string[];
  /** Present on native ledger rows; required for helper artifact transfer. */
  operationId?: string;
  observationsPending?: boolean;
}
