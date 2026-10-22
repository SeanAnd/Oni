import { loadJobDetail } from './jobHistoryService';
import { getJobSummary } from './jobClient';
import type { JobSummary } from '@/core/models/job.model';
import { ProjectService } from '@/core/projects/projectService';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
jest.mock('./jobClient', () => ({getJobSummary: jest.fn()}));
beforeEach(() => { installTestAppStateDatabase(); });
afterEach(resetTestAppStateDatabase);
it('requires project ownership for a routed job and still permits workstation maintenance', async () => {
 const job: JobSummary = {id: 'job', projectId: 'missing', type: 'nmap.scan', capabilityId: 'network.service_detection', providerId: 'provider.kali.nmap', status: 'completed', artifactIds: []};
 jest.mocked(getJobSummary).mockResolvedValue(job);
 expect(await loadJobDetail('job')).toBeNull();
 const result = await new ProjectService().createProject({name: 'Owned project', description: ''});
 jest.mocked(getJobSummary).mockResolvedValue({...job, projectId: result.project!.id});
 expect((await loadJobDetail('job'))?.projectId).toBe(result.project!.id);
 jest.mocked(getJobSummary).mockResolvedValue({...job, projectId: 'system-onboarding'});
 expect(await loadJobDetail('job')).not.toBeNull();
});
