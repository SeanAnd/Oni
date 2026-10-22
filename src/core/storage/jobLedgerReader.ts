/**
 * Read-only access to the native job ledger. Writes go through `jobClient` → SkidJobs only.
 */
export {
  getJobSummary as readJobSummary,
  listJobSummaries as readJobSummaries,
} from '@/core/jobs/jobClient';
