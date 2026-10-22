import { runOnboardingHealthJob } from './onboardingHealthJob';
import { enqueueKaliHealthJob, getJobSummary } from '@/core/jobs/jobClient';
import type { JobSummary } from '@/core/models/job.model';
jest.mock('@/core/jobs/jobClient', () => ({enqueueKaliHealthJob: jest.fn(), getJobSummary: jest.fn()}));
afterEach(() => { jest.useRealTimers(); jest.resetAllMocks(); });
it('does not treat a queued health job as completed onboarding', async () => {
  jest.useFakeTimers();
  jest.mocked(enqueueKaliHealthJob).mockResolvedValue({ok: true, jobId: 'job'});
  jest.mocked(getJobSummary).mockResolvedValueOnce({status: 'running'} as JobSummary).mockResolvedValueOnce({status: 'completed'} as JobSummary);
  let finished = false;
  const operation = runOnboardingHealthJob('job', 'system').then((result) => {finished = true; return result;});
  await jest.advanceTimersByTimeAsync(100);
  expect(finished).toBe(false);
  await jest.advanceTimersByTimeAsync(500);
  expect(await operation).toEqual({ok: true});
});
it('reports backend health failure rather than advancing', async () => {
  jest.mocked(enqueueKaliHealthJob).mockResolvedValue({ok: true});
  jest.mocked(getJobSummary).mockResolvedValue({status: 'failed', errorKey: 'NETHUNTER_NOT_FOUND'} as JobSummary);
  expect(await runOnboardingHealthJob('job', 'system')).toEqual({ok: false, errorKey: 'NETHUNTER_NOT_FOUND'});
});
