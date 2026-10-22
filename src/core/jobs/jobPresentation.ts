import type { JobSummary } from '@/core/models/job.model';
export function jobStatusLabel(job: JobSummary): string { return job.status.replaceAll('_', ' '); }
export function canCancelJob(job: JobSummary): boolean { return !['completed', 'failed', 'cancelled'].includes(job.status); }
export function resultStateLabel(job: JobSummary): string {
  if (job.processing?.state === 'failed') return 'Command completed; results could not be processed.';
  if (job.observationsPending) return 'Observations pending ingestion.';
  if (job.status === 'completed' && job.type === 'nmap.scan') return 'Results ready';
  return 'No pending result processing.';
}
export function mergeJobSummaries(jobs: JobSummary[]): JobSummary[] {
  return [...new Map(jobs.map(job => [job.id, job])).values()].sort((a, b) => (b.startedAt ?? b.finishedAt ?? '').localeCompare(a.startedAt ?? a.finishedAt ?? '') || a.id.localeCompare(b.id));
}
