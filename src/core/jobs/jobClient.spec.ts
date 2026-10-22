import { enqueueJobSpec, markJobResultIngested } from '@/core/jobs/jobClient';
import { __setJobsModuleForTests } from '~/modules/jobs/src/index';

jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => 'test-token',
  setItemAsync: async () => undefined,
}));

describe('job client', () => {
  afterEach(() => {
    __setJobsModuleForTests(null);
  });

  it('validates specs before touching native persistence', async () => {
    const result = await enqueueJobSpec({
      id: '',
      projectId: 'project-1',
      type: 'workstation.kali_health',
      capabilityId: 'workstation.health',
      providerId: 'provider.kali.health',
      parameters: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errorKey).toBe('INVALID_PAYLOAD');
  });

  it('persists through SkidJobs after validation', async () => {
    __setJobsModuleForTests({
      configureTermuxHelperToken: async () => ({ ok: true }),
      enqueueJob: async () => ({ ok: true, jobId: 'job-abc' }),
      cancelJob: async () => ({ ok: true }),
      getJob: async () => null,
      listJobs: async () => [],
      reconcile: async () => ({ ok: true, reconciledCount: 0 }),
      markResultIngested: async () => ({ ok: true, inserted: true }),
      addListener: () => ({ remove: () => undefined }),
    });

    const result = await enqueueJobSpec({
      id: 'job-abc',
      projectId: 'project-1',
      type: 'workstation.kali_health',
      capabilityId: 'workstation.health',
      providerId: 'provider.kali.health',
      parameters: { probe: 'kali_health' },
    });
    expect(result.ok).toBe(true);
    expect(result.jobId).toBe('job-abc');
  });

  it('accepts an already persisted ingestion acknowledgement after a retry', async () => {
    __setJobsModuleForTests({
      configureTermuxHelperToken: async () => ({ok: true}),
      enqueueJob: async () => ({ok: true}), cancelJob: async () => ({ok: true}),
      getJob: async () => null, listJobs: async () => [],
      reconcile: async () => ({ok: true, reconciledCount: 0}),
      markResultIngested: async () => ({ok: true, inserted: false}),
      addListener: () => ({remove: () => undefined}),
    });
    expect(await markJobResultIngested('job-abc', 'observations:job-abc')).toBe(true);
  });
});
