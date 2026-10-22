import { canCancelJob, mergeJobSummaries, resultStateLabel } from './jobPresentation';
import type { JobSummary } from '@/core/models/job.model';
const job: JobSummary = { id: 'job', projectId: 'p', type: 'nmap.scan', capabilityId: 'network.service_detection', providerId: 'provider.kali.nmap', status: 'completed', artifactIds: [], observationsPending: true };
it('separates process completion from result processing and only allows cancellation before terminal state', () => {
  expect(canCancelJob(job)).toBe(false); expect(canCancelJob({ ...job, status: 'waiting_for_device' })).toBe(true);
  expect(resultStateLabel(job)).toBe('Observations pending ingestion.');
  expect(resultStateLabel({ ...job, processing: { state: 'failed', errorKey: 'PARSER_FAILED', attemptCount: 1, updatedAt: 'now' } })).toContain('could not be processed');
});
it('deduplicates maintenance and sorts newest jobs first', () => {
  const newer = { ...job, id: 'newer', startedAt: '2026-09-25' };
  expect(mergeJobSummaries([job, newer, job]).map(item => item.id)).toEqual(['newer', 'job']);
});
