import { mergeJobSummaries } from './jobPresentation';
import { ProjectRepository } from '@/core/storage/projectRepository';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { ResultProcessingRepository } from '@/core/storage/resultProcessingRepository';
import { getJobSummary, listJobSummaries } from '@/core/jobs/jobClient';
import type { JobSummary } from '@/core/models/job.model';

/** Read-only job history facade; screens never query the native ledger SQL directly. */
export async function loadJobSummaries(projectId?: string, limit = 50): Promise<JobSummary[]> {
  const scoped = await listJobSummaries(projectId, limit);
  const maintenance = projectId && projectId !== SYSTEM_PROJECT_ID ? await listJobSummaries(SYSTEM_PROJECT_ID, limit) : [];
  const jobs = mergeJobSummaries([...maintenance, ...scoped]);
  const processing = new ResultProcessingRepository(openAppStateDatabase());
  return jobs.map(job => ({...job, processing: processing.get(job.projectId, job.id) ?? undefined}));
}

export async function loadJobDetail(jobId: string): Promise<JobSummary | null> {
  const job = await getJobSummary(jobId);
  if (job && job.projectId !== SYSTEM_PROJECT_ID && !(await new ProjectRepository(openAppStateDatabase()).ownsProject(job.projectId))) return null;
  return job ? {...job, processing: new ResultProcessingRepository(openAppStateDatabase()).get(job.projectId, job.id) ?? undefined} : null;
}
