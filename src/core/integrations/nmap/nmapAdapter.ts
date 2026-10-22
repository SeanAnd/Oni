import type { JobSpec, StructuredCommand } from '@/core/models/job.model';
import type { Observation } from '@/core/models/observation.model';
import { validateNmapPorts } from '@/core/validators/nmapPorts.validators';
import { validateNmapTarget } from '@/core/validators/nmapTarget.validators';

import { parseNmapXml, type NmapParseOutcome } from '@/core/integrations/nmap/nmapXmlParser';

export const NMAP_JOB_TYPE = 'nmap.scan' as const;
export const NMAP_CAPABILITY_ID = 'network.service_detection' as const;
export const NMAP_PROVIDER_ID = 'provider.kali.nmap' as const;

export interface NmapScanExecutionParams {
  projectId: string;
  target: string;
  ports: string;
  serviceDetection: boolean;
  timeoutMs: number;
}

export interface BuildNmapJobSpecInput extends NmapScanExecutionParams {
  jobId: string;
}

export type NmapExecutionValidationErrorKey =
  | 'NMAP_TARGET_REQUIRED'
  | 'NMAP_TARGET_INVALID'
  | 'NMAP_TARGET_TOO_LARGE'
  | 'NMAP_PORTS_REQUIRED'
  | 'NMAP_PORTS_INVALID'
  | 'NMAP_PORTS_TOO_MANY'
  | 'NMAP_TIMEOUT_INVALID';

export function validateNmapScanExecutionParams(
  params: NmapScanExecutionParams,
): { ok: true } | { ok: false; errorKey: NmapExecutionValidationErrorKey } {
  const target = validateNmapTarget(params.target);
  if (!target.ok) {
    return { ok: false, errorKey: target.errorKey ?? 'NMAP_TARGET_INVALID' };
  }
  const ports = validateNmapPorts(params.ports);
  if (!ports.ok) {
    return { ok: false, errorKey: ports.errorKey ?? 'NMAP_PORTS_INVALID' };
  }
  if (!Number.isSafeInteger(params.timeoutMs) || params.timeoutMs < 15_000 || params.timeoutMs > 180_000) {
    return { ok: false, errorKey: 'NMAP_TIMEOUT_INVALID' };
  }
  return { ok: true };
}

/** Rootless TCP connect scan argv; no freeform flags or privileged modes. */
export function buildNmapArgv(params: Pick<NmapScanExecutionParams, 'target' | 'ports' | 'serviceDetection'>): string[] {
  const args: string[] = ['--unprivileged', '-sT', '-Pn', '-n', '-p', validateNmapPorts(params.ports).normalized ?? params.ports.trim(), '-oX', '-'];
  if (params.serviceDetection) {
    args.push('-sV');
  }
  args.push(params.target.trim());
  return args;
}

export function buildNmapStructuredCommand(
  params: Pick<NmapScanExecutionParams, 'target' | 'ports' | 'serviceDetection'>,
): StructuredCommand {
  return {
    binary: 'nmap',
    args: buildNmapArgv(params),
  };
}

export function buildNmapJobSpec(input: BuildNmapJobSpecInput): JobSpec {
  const validation = validateNmapScanExecutionParams(input);
  if (!validation.ok) {
    throw new Error(validation.errorKey);
  }
  const command = buildNmapStructuredCommand(input);
  return {
    id: input.jobId,
    projectId: input.projectId,
    type: NMAP_JOB_TYPE,
    capabilityId: NMAP_CAPABILITY_ID,
    providerId: NMAP_PROVIDER_ID,
    parameters: {
      target: input.target.trim(),
      ports: input.ports.trim(),
      serviceDetection: input.serviceDetection,
      scanProfile: 'rootless_tcp_connect',
    },
    command,
    timeoutMs: input.timeoutMs,
  };
}

export function parseNmapScanResult(xml: string, context: { jobId: string; targetHint?: string }): NmapParseOutcome {
  return parseNmapXml(xml, context);
}

export function observationsFromParseOutcome(
  outcome: NmapParseOutcome,
  context: { jobId: string; targetId?: string },
): Observation[] {
  if (outcome.status !== 'ok' && outcome.status !== 'empty') {
    return [];
  }
  return outcome.observations.map((observation) => ({
    ...observation,
    jobId: context.jobId,
    targetId: observation.targetId ?? context.targetId,
  }));
}
