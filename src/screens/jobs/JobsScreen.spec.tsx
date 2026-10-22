import { render, screen } from '@testing-library/react-native';

import { JobsScreen } from '@/screens/jobs/JobsScreen';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
import { __setJobsModuleForTests } from '~/modules/jobs/src/index';

describe('JobsScreen', () => {
  beforeEach(() => {
    installTestAppStateDatabase();
    __setJobsModuleForTests({
      configureTermuxHelperToken: async () => ({ ok: true }),
      enqueueJob: async () => ({ ok: true, jobId: 'job-1' }),
      cancelJob: async () => ({ ok: true, jobId: 'job-1' }),
      getJob: async () => null,
      listJobs: async () => [],
      reconcile: async () => ({ ok: true, reconciledCount: 0 }),
      markResultIngested: async () => ({ ok: true, inserted: true }),
      addListener: () => ({ remove: () => undefined }),
    });
  });

  afterEach(() => {
    resetTestAppStateDatabase();
    __setJobsModuleForTests(null);
  });

  it('shows an empty job history state without SQL access', async () => {
    await render(<JobsScreen />);
    expect(await screen.findByText('No jobs recorded yet.')).toBeTruthy();
  });
});
