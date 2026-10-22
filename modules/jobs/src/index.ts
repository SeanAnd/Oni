import { requireNativeModule, type EventSubscription } from 'expo-modules-core';

import type { JobSummary } from '@/core/models/job.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export interface EnqueueJobResult {
  ok: boolean;
  jobId?: string;
  errorKey?: SkidErrorKey;
  detail?: string;
}

export interface JobUpdatedEvent {
  summary: JobSummary;
}

type SkidJobsModule = {
  configureTermuxHelperToken(token: string | null): Promise<{ ok: boolean }>;
  enqueueJob(specJson: string): Promise<EnqueueJobResult>;
  cancelJob(jobId: string): Promise<{ ok: boolean; jobId?: string; errorKey?: SkidErrorKey }>;
  getJob(jobId: string): Promise<JobSummary | null>;
  listJobs(projectId: string | null, limit: number): Promise<JobSummary[]>;
  reconcile(): Promise<{ ok: boolean; reconciledCount: number }>;
  markResultIngested(jobId: string, marker: string): Promise<{ ok: boolean; inserted: boolean }>;
  addListener(event: 'onJobUpdated', listener: (event: JobUpdatedEvent) => void): EventSubscription;
};

let nativeModule: SkidJobsModule | null | undefined;

function getModule(): SkidJobsModule | null {
  if (nativeModule !== undefined) {
    return nativeModule;
  }
  try {
    nativeModule = requireNativeModule<SkidJobsModule>('SkidJobs');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

const unavailableDetail = 'SkidJobs native module is not loaded (development build required).';

export async function configureTermuxHelperToken(token: string | null): Promise<boolean> {
  const module = getModule();
  if (!module) {
    return false;
  }
  const result = await module.configureTermuxHelperToken(token);
  return result.ok;
}

export async function enqueueJobNative(specJson: string): Promise<EnqueueJobResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableDetail };
  }
  return module.enqueueJob(specJson);
}

export async function cancelJobNative(jobId: string): Promise<boolean> {
  const module = getModule();
  if (!module) {
    return false;
  }
  const result = await module.cancelJob(jobId);
  return result.ok;
}

export async function getJobNative(jobId: string): Promise<JobSummary | null> {
  const module = getModule();
  if (!module) {
    return null;
  }
  return module.getJob(jobId);
}

export async function listJobsNative(projectId: string | null, limit = 50): Promise<JobSummary[]> {
  const module = getModule();
  if (!module) {
    return [];
  }
  return module.listJobs(projectId, limit);
}

export async function reconcileJobsNative(): Promise<number> {
  const module = getModule();
  if (!module) {
    return 0;
  }
  const result = await module.reconcile();
  return result.reconciledCount ?? 0;
}

export async function markJobResultIngestedNative(jobId: string, marker: string): Promise<boolean> {
  const module = getModule();
  if (!module) {
    return false;
  }
  const result = await module.markResultIngested(jobId, marker);
  // An existing marker is a successful acknowledgement on recovery too.
  return result.ok;
}

export function subscribeJobUpdates(listener: (event: JobUpdatedEvent) => void): EventSubscription | null {
  const module = getModule();
  if (!module) {
    return null;
  }
  return module.addListener('onJobUpdated', listener);
}

/** Test hook to inject a native double without loading Expo modules. */
export function __setJobsModuleForTests(double: SkidJobsModule | null): void {
  nativeModule = double;
}
