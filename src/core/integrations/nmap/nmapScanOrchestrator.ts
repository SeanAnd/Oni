import { checkSetupAccess } from '@/core/state/setupReadiness';
import { CapabilityResolver } from '@/core/capabilities/resolver';
import { createProjectOwnershipGate } from '@/core/projects/projectService';
import { enqueueJobSpec } from '@/core/jobs/jobClient';
import type { JobSummary } from '@/core/models/job.model';
import {
  buildNmapJobSpec,
  NMAP_CAPABILITY_ID,
  NMAP_PROVIDER_ID,
  validateNmapScanExecutionParams,
  type NmapScanExecutionParams,
} from '@/core/integrations/nmap/nmapAdapter';
import { ingestCompletedNmapJob, type NmapIngestionResult } from '@/core/integrations/nmap/nmapResultIngestion';

export interface StartNmapScanResult {
  ok: boolean;
  jobId?: string;
  errorKey?: string;
  detail?: string;
}

export class NmapScanOrchestrator {
  constructor(
    private readonly resolver = new CapabilityResolver(undefined, createProjectOwnershipGate()),
  ) {}

  async startScan(jobId: string, params: NmapScanExecutionParams): Promise<StartNmapScanResult> {
    const paramCheck = validateNmapScanExecutionParams(params);
    if (!paramCheck.ok) {
      return { ok: false, errorKey: paramCheck.errorKey, detail: 'Scan parameters failed execution validation.' };
    }

    const setup = await checkSetupAccess();
    if (!setup.allowed) return {ok:false, errorKey:setup.errorKey, detail:setup.detail};

    const precheck = await this.resolver.precheckExecution({
      capabilityId: NMAP_CAPABILITY_ID,
      providerId: NMAP_PROVIDER_ID,
      projectId: params.projectId,
    });
    if (!precheck.allowed) {
      return {
        ok: false,
        errorKey: precheck.errorKey ?? 'CAPABILITY_UNAVAILABLE',
        detail: precheck.reasons[0]?.detail,
      };
    }

    let spec;
    try {
      spec = buildNmapJobSpec({ jobId, ...params });
    } catch (error) {
      return {
        ok: false,
        errorKey: 'INVALID_PAYLOAD',
        detail: error instanceof Error ? error.message : 'Unable to build job spec.',
      };
    }

    const enqueue = await enqueueJobSpec(spec);
    if (!enqueue.ok) {
      return { ok: false, errorKey: enqueue.errorKey, detail: enqueue.detail };
    }
    return { ok: true, jobId: enqueue.jobId ?? jobId };
  }

  async ingestWhenReady(
    summary: JobSummary,
    context?: { targetId?: string; targetHint?: string },
  ): Promise<NmapIngestionResult> {
    return ingestCompletedNmapJob(summary, context);
  }
}
