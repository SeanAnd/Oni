import type { Resolver } from 'react-hook-form';

import type { JobSpec } from '@/core/models/job.model';
import {
  buildNmapJobSpec,
  type NmapScanExecutionParams,
  validateNmapScanExecutionParams,
} from '@/core/integrations/nmap/nmapAdapter';
import { validateNmapPorts } from '@/core/validators/nmapPorts.validators';
import { validateNmapTarget } from '@/core/validators/nmapTarget.validators';

export const NMAP_SCAN_MIN_TIMEOUT_MS = 15_000;
export const NMAP_SCAN_MAX_TIMEOUT_MS = 180_000;
export const NMAP_SCAN_DEFAULT_TIMEOUT_MS = 120_000;

export interface NmapScanFormValue {
  target: string;
  ports: string;
  serviceDetection: boolean;
  timeoutMs: number;
}

export function createNmapScanFormValue(): NmapScanFormValue {
  return {
    target: '',
    ports: '22,80,443',
    serviceDetection: true,
    timeoutMs: NMAP_SCAN_DEFAULT_TIMEOUT_MS,
  };
}

export type NmapScanFieldErrorKey =
  | 'NMAP_TARGET_REQUIRED'
  | 'NMAP_TARGET_INVALID'
  | 'NMAP_TARGET_TOO_LARGE'
  | 'NMAP_PORTS_REQUIRED'
  | 'NMAP_PORTS_INVALID'
  | 'NMAP_PORTS_TOO_MANY'
  | 'NMAP_TIMEOUT_INVALID'
  | 'NMAP_NO_ACTIVE_PROJECT';

export interface NmapScanFormValidationResult {
  ok: boolean;
  fieldErrors?: Partial<Record<keyof NmapScanFormValue, NmapScanFieldErrorKey>>;
  formError?: NmapScanFieldErrorKey;
  executionParams?: NmapScanExecutionParams;
}

export interface NmapScanFormResolverContext {
  projectId: string | null;
}

export function validateNmapScanFormValue(
  value: NmapScanFormValue,
  context: NmapScanFormResolverContext,
): NmapScanFormValidationResult {
  if (!context.projectId?.trim()) {
    return { ok: false, formError: 'NMAP_NO_ACTIVE_PROJECT' };
  }

  const fieldErrors: Partial<Record<keyof NmapScanFormValue, NmapScanFieldErrorKey>> = {};
  const targetResult = validateNmapTarget(value.target);
  if (!targetResult.ok) {
    fieldErrors.target = targetResult.errorKey;
  }
  const portsResult = validateNmapPorts(value.ports);
  if (!portsResult.ok) {
    fieldErrors.ports = portsResult.errorKey;
  }
  if (
    !Number.isFinite(value.timeoutMs) ||
    value.timeoutMs < NMAP_SCAN_MIN_TIMEOUT_MS ||
    value.timeoutMs > NMAP_SCAN_MAX_TIMEOUT_MS
  ) {
    fieldErrors.timeoutMs = 'NMAP_TIMEOUT_INVALID';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }

  const executionParams: NmapScanExecutionParams = {
    projectId: context.projectId,
    target: targetResult.normalized!,
    ports: portsResult.normalized!,
    serviceDetection: value.serviceDetection,
    timeoutMs: Math.round(value.timeoutMs),
  };

  const executionCheck = validateNmapScanExecutionParams(executionParams);
  if (!executionCheck.ok) {
    return {
      ok: false,
      formError: executionCheck.errorKey as NmapScanFieldErrorKey | undefined,
    };
  }

  return { ok: true, executionParams };
}

export function nmapScanFormResolver(context: NmapScanFormResolverContext): Resolver<NmapScanFormValue> {
  return async (values) => {
    const result = validateNmapScanFormValue(values, context);
    if (result.ok) {
      return { values, errors: {} };
    }
    const errors: Record<string, { type: string; message: string }> = {};
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      errors[field] = { type: 'validation', message };
    }
    if (result.formError) {
      errors.root = { type: 'validation', message: result.formError };
    }
    return { values: {}, errors };
  };
}

export function toNmapJobSpecFromForm(
  jobId: string,
  executionParams: NmapScanExecutionParams,
): JobSpec {
  return buildNmapJobSpec({ jobId, ...executionParams });
}
