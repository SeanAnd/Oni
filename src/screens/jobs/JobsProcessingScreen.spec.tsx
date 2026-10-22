import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { JobDetailScreen } from './JobDetailScreen';
import { loadJobDetail, loadJobSummaries } from '@/core/jobs/jobHistoryService';
import { ingestCompletedNmapJob } from '@/core/integrations/nmap/nmapResultIngestion';
import type { JobSummary } from '@/core/models/job.model';
jest.mock('expo-router', () => ({
  useRouter: () => ({push: jest.fn()}),
  useLocalSearchParams: () => ({jobId: 'job'}),
  useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));

jest.mock('@/core/projects/projectService', () => ({ProjectService: jest.fn(() => ({getActiveProjectId: async () => 'project', reconcileOnResume: async () => undefined}))}));
jest.mock('@/core/jobs/jobClient', () => ({watchJobUpdates: () => ({remove: () => undefined}), cancelJob: jest.fn()}));
jest.mock('@/core/jobs/jobHistoryService', () => ({loadJobDetail: jest.fn(), loadJobSummaries: jest.fn()}));
jest.mock('@/core/integrations/nmap/nmapResultIngestion', () => ({ingestCompletedNmapJob: jest.fn()}));
it('shows independent completed-command failure and explicitly retries processing', async () => {
  const job: JobSummary = {id: 'job', projectId: 'project', type: 'nmap.scan', providerId: 'provider.kali.nmap', capabilityId: 'network.service_detection', status: 'completed', artifactIds: ['xml'], observationsPending: true, processing: {state: 'failed', errorKey: 'PARSER_FAILED', detail: 'Truncated XML remains retained.', attemptCount: 1, artifactHash: 'a'.repeat(64), updatedAt: 'now'}};
  jest.mocked(loadJobSummaries).mockResolvedValue([job]);
  jest.mocked(loadJobDetail).mockResolvedValue(job);
  jest.mocked(ingestCompletedNmapJob).mockResolvedValue({ok: false, artifactIngested: true, observationsIngested: false, errorKey: 'PARSER_FAILED'});
  await render(<JobDetailScreen />);
  expect(await screen.findByText('Command completed; results could not be processed.')).toBeOnTheScreen();
  expect(screen.queryByText('Observations pending ingestion.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', {name: 'Retry processing'}));
  await waitFor(() => expect(ingestCompletedNmapJob).toHaveBeenCalledWith(job, expect.objectContaining({retry: true})));
});
