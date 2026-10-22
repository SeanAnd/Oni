import { type CapabilityId, isCapabilityId } from '@/core/capabilities/capabilityIds';
import { type ProviderId, isProviderId } from '@/core/capabilities/providerIds';
import { type JobEventType, isJobEventType } from '@/core/models/jobEvents.model';
import { type JobStatus, isJobStatus } from '@/core/models/job.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';
import { isSkidErrorKey } from '@/core/security/errorKeys';

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errorKey: 'INVALID_PAYLOAD'; issues: string[] };

function fail<T>(issues: string[]): ValidationResult<T> {
  return { ok: false, errorKey: 'INVALID_PAYLOAD', issues };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export interface ValidatedStructuredCommand {
  binary: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export function validateStructuredCommand(payload: unknown): ValidationResult<ValidatedStructuredCommand> {
  if (!isPlainObject(payload)) {
    return fail(['command must be an object']);
  }
  const issues: string[] = [];
  if (!isNonEmptyString(payload.binary)) {
    issues.push('command.binary must be a non-empty string');
  }
  if (!isStringArray(payload.args)) {
    issues.push('command.args must be an array of strings');
  }
  if (payload.cwd !== undefined && typeof payload.cwd !== 'string') {
    issues.push('command.cwd must be a string when present');
  }
  if (payload.env !== undefined) {
    if (!isPlainObject(payload.env)) {
      issues.push('command.env must be an object when present');
    } else {
      for (const [key, val] of Object.entries(payload.env)) {
        if (typeof val !== 'string') {
          issues.push(`command.env.${key} must be a string`);
        }
      }
    }
  }
  if (issues.length > 0) {
    return fail(issues);
  }
  return {
    ok: true,
    value: {
      binary: payload.binary as string,
      args: payload.args as string[],
      cwd: typeof payload.cwd === 'string' ? payload.cwd : undefined,
      env: isPlainObject(payload.env)
        ? Object.fromEntries(
            Object.entries(payload.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          )
        : undefined,
    },
  };
}

export interface ValidatedJobSpecPayload {
  id: string;
  projectId: string;
  type: string;
  capabilityId: CapabilityId;
  providerId: ProviderId;
  parameters: Record<string, unknown>;
  command?: ValidatedStructuredCommand;
  timeoutMs?: number;
}

export function validateJobSpecPayload(payload: unknown): ValidationResult<ValidatedJobSpecPayload> {
  if (!isPlainObject(payload)) {
    return fail(['job spec must be an object']);
  }
  const issues: string[] = [];
  if (!isNonEmptyString(payload.id)) {
    issues.push('id must be a non-empty string');
  }
  if (!isNonEmptyString(payload.projectId)) {
    issues.push('projectId must be a non-empty string');
  }
  if (!isNonEmptyString(payload.type)) {
    issues.push('type must be a non-empty string');
  }
  if (!isCapabilityId(payload.capabilityId)) {
    issues.push('capabilityId is invalid');
  }
  if (!isProviderId(payload.providerId)) {
    issues.push('providerId is invalid');
  }
  if (!isPlainObject(payload.parameters)) {
    issues.push('parameters must be an object');
  }
  let command: ValidatedStructuredCommand | undefined;
  if (payload.command !== undefined) {
    const commandResult = validateStructuredCommand(payload.command);
    if (!commandResult.ok) {
      issues.push(...commandResult.issues.map((issue) => `command.${issue}`));
    } else {
      command = commandResult.value;
    }
  }
  if (payload.timeoutMs !== undefined && (typeof payload.timeoutMs !== 'number' || payload.timeoutMs <= 0)) {
    issues.push('timeoutMs must be a positive number when present');
  }
  if (issues.length > 0) {
    return fail(issues);
  }
  return {
    ok: true,
    value: {
      id: payload.id as string,
      projectId: payload.projectId as string,
      type: payload.type as string,
      capabilityId: payload.capabilityId as CapabilityId,
      providerId: payload.providerId as ProviderId,
      parameters: payload.parameters as Record<string, unknown>,
      command,
      timeoutMs: typeof payload.timeoutMs === 'number' ? payload.timeoutMs : undefined,
    },
  };
}

export interface ValidatedJobResultPayload {
  jobId: string;
  exitCode: number | null;
  artifactIds: string[];
  observationsPending: boolean;
  errorKey?: SkidErrorKey;
}

export function validateJobResultPayload(payload: unknown): ValidationResult<ValidatedJobResultPayload> {
  if (!isPlainObject(payload)) {
    return fail(['job result must be an object']);
  }
  const issues: string[] = [];
  if (!isNonEmptyString(payload.jobId)) {
    issues.push('jobId must be a non-empty string');
  }
  if (payload.exitCode !== null && typeof payload.exitCode !== 'number') {
    issues.push('exitCode must be a number or null');
  }
  if (!Array.isArray(payload.artifactIds) || !payload.artifactIds.every((id) => typeof id === 'string')) {
    issues.push('artifactIds must be an array of strings');
  }
  if (typeof payload.observationsPending !== 'boolean') {
    issues.push('observationsPending must be a boolean');
  }
  if (payload.errorKey !== undefined && !isSkidErrorKey(payload.errorKey)) {
    issues.push('errorKey is invalid');
  }
  if (issues.length > 0) {
    return fail(issues);
  }
  return {
    ok: true,
    value: {
      jobId: payload.jobId as string,
      exitCode: payload.exitCode as number | null,
      artifactIds: payload.artifactIds as string[],
      observationsPending: payload.observationsPending as boolean,
      errorKey: isSkidErrorKey(payload.errorKey) ? payload.errorKey : undefined,
    },
  };
}

export interface ValidatedObservationPayload {
  type: string;
  source: string;
  data: Record<string, unknown>;
  targetId?: string;
  jobId?: string;
  projectId?: string;
}

export function validateObservationPayload(payload: unknown): ValidationResult<ValidatedObservationPayload> {
  if (!isPlainObject(payload)) {
    return fail(['observation must be an object']);
  }
  const issues: string[] = [];
  if (!isNonEmptyString(payload.type)) {
    issues.push('type must be a non-empty string');
  }
  if (!isNonEmptyString(payload.source)) {
    issues.push('source must be a non-empty string');
  }
  if (!isPlainObject(payload.data)) {
    issues.push('data must be an object');
  }
  if (issues.length > 0) {
    return fail(issues);
  }
  return {
    ok: true,
    value: {
      type: payload.type as string,
      source: payload.source as string,
      data: payload.data as Record<string, unknown>,
      targetId: typeof payload.targetId === 'string' ? payload.targetId : undefined,
      jobId: typeof payload.jobId === 'string' ? payload.jobId : undefined,
      projectId: typeof payload.projectId === 'string' ? payload.projectId : undefined,
    },
  };
}

export interface ValidatedJobEventEnvelope {
  type: JobEventType;
  jobId: string;
  sequence: number;
  emittedAt: string;
}

export function validateJobEventEnvelope(payload: unknown): ValidationResult<ValidatedJobEventEnvelope> {
  if (!isPlainObject(payload)) {
    return fail(['job event must be an object']);
  }
  const issues: string[] = [];
  if (!isJobEventType(payload.type)) {
    issues.push('type is invalid');
  }
  if (!isNonEmptyString(payload.jobId)) {
    issues.push('jobId must be a non-empty string');
  }
  if (typeof payload.sequence !== 'number' || !Number.isInteger(payload.sequence) || payload.sequence < 0) {
    issues.push('sequence must be a non-negative integer');
  }
  if (!isNonEmptyString(payload.emittedAt)) {
    issues.push('emittedAt must be a non-empty string');
  }
  if (issues.length > 0) {
    return fail(issues);
  }
  return {
    ok: true,
    value: {
      type: payload.type as JobEventType,
      jobId: payload.jobId as string,
      sequence: payload.sequence as number,
      emittedAt: payload.emittedAt as string,
    },
  };
}

export interface ValidatedJobStatusUpdatePayload {
  jobId: string;
  status: JobStatus;
}

export function validateJobStatusUpdatePayload(
  payload: unknown,
): ValidationResult<ValidatedJobStatusUpdatePayload> {
  if (!isPlainObject(payload)) {
    return fail(['job status update must be an object']);
  }
  const issues: string[] = [];
  if (!isNonEmptyString(payload.jobId)) {
    issues.push('jobId must be a non-empty string');
  }
  if (!isJobStatus(payload.status)) {
    issues.push('status is invalid');
  }
  if (issues.length > 0) {
    return fail(issues);
  }
  return {
    ok: true,
    value: {
      jobId: payload.jobId as string,
      status: payload.status as JobStatus,
    },
  };
}

