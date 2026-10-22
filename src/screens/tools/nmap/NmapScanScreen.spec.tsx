import { SETUP_TASKS } from '@/core/models/setupTask.model';
import { writeOnboardingProgress } from '@/core/state/onboardingProgress';
import { act, render, screen, userEvent } from '@testing-library/react-native';
import { getJobSummary, watchJobUpdates } from '@/core/jobs/jobClient';
import type { JobSummary } from '@/core/models/job.model';

import { NmapScanScreen } from '@/screens/tools/nmap/NmapScanScreen';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';

jest.mock('@/core/capabilities/resolver', () => {
  const actual = jest.requireActual<typeof import('@/core/capabilities/resolver')>('@/core/capabilities/resolver');
  return {
    ...actual,
    defaultCapabilityResolver: {
      resolve: jest.fn(async () => ({
        capabilityId: 'network.service_detection',
        resolved: true,
        providerId: 'provider.kali.nmap',
        availability: { id: 'network.service_detection', available: true, providerId: 'provider.kali.nmap', reasons: [] },
      })),
    },
  };
});

jest.mock('@/core/integrations/nmap/nmapScanOrchestrator', () => ({
  NmapScanOrchestrator: jest.fn().mockImplementation(() => ({
    startScan: jest.fn(async () => ({ ok: true, jobId: 'job-nmap-test' })),
    ingestWhenReady: jest.fn(async () => ({ ok: true, artifactIngested: true, observationsIngested: true })),
  })),
}));

jest.mock('@/core/jobs/jobClient', () => ({
  getJobSummary: jest.fn(async () => ({
    id: 'job-nmap-test',
    projectId: 'proj-test',
    type: 'nmap.scan',
    capabilityId: 'network.service_detection',
    providerId: 'provider.kali.nmap',
    status: 'running',
    artifactIds: [],
  })),
  watchJobUpdates: jest.fn(() => ({ remove: jest.fn() })),
}));

describe('NmapScanScreen', () => {
  beforeEach(async () => {
    installTestAppStateDatabase();
    await writeOnboardingProgress({completedSteps:[...SETUP_TASKS],onboardingComplete:true},'termux-local');
  });

  afterEach(() => {
    resetTestAppStateDatabase();
    jest.clearAllMocks();
  });

  it('orchestrates scan dispatch when a project is active', async () => {
    const { ProjectService } = jest.requireActual<typeof import('@/core/projects/projectService')>(
      '@/core/projects/projectService',
    );
    const service = new ProjectService();
    await service.createProject({ name: 'Scan Lab', description: '' });

    await render(<NmapScanScreen />);
    expect(screen.getByRole('switch',{name:'Service detection'}).props.accessibilityState.checked).toBe(true);
    await userEvent.press(screen.getByRole('switch',{name:'Service detection'}));
    expect(screen.getByRole('switch',{name:'Service detection'}).props.accessibilityState.checked).toBe(false);
    await userEvent.type(screen.getByLabelText('Scan target'), '192.168.1.10');
    await userEvent.press(screen.getByRole('button', { name: 'Run scan' }));

    expect(await screen.findByText(/Scan queued/)).toBeTruthy();
  });

  it('refreshes state missed before subscribing without replacing newer events', async () => {
    const { ProjectService } = jest.requireActual<typeof import('@/core/projects/projectService')>(
      '@/core/projects/projectService',
    );
    await new ProjectService().createProject({ name: 'Race Lab', description: '' });
    const running = await getJobSummary('job-nmap-test') as JobSummary;
    const queued = { ...running, status: 'queued' as const };
    let resolveSnapshot!: (summary: JobSummary) => void;
    jest.mocked(getJobSummary)
      .mockResolvedValueOnce(queued)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSnapshot = resolve; }));
    await render(<NmapScanScreen />);
    await userEvent.type(screen.getByLabelText('Scan target'), '127.0.0.1');
    await userEvent.press(screen.getByRole('button', { name: 'Run scan' }));
    expect(await screen.findByText('Status: queued')).toBeTruthy();
    const listener = jest.mocked(watchJobUpdates).mock.calls.at(-1)![0];
    await act(async () => { listener({ summary: running }); });
    expect(screen.getByText('Status: running')).toBeTruthy();
    await act(async () => { resolveSnapshot(queued); });
    expect(screen.getByText('Status: running')).toBeTruthy();
  });

  it('loads a terminal transition that happened before the listener attached', async () => {
    const { ProjectService } = jest.requireActual<typeof import('@/core/projects/projectService')>(
      '@/core/projects/projectService',
    );
    await new ProjectService().createProject({ name: 'Fast Lab', description: '' });
    const running = await getJobSummary('job-nmap-test') as JobSummary;
    jest.mocked(getJobSummary)
      .mockResolvedValueOnce({ ...running, status: 'queued' })
      .mockResolvedValueOnce({ ...running, status: 'cancelled' });
    await render(<NmapScanScreen />);
    await userEvent.type(screen.getByLabelText('Scan target'), '127.0.0.1');
    await userEvent.press(screen.getByRole('button', { name: 'Run scan' }));
    expect(await screen.findByText('Status: cancelled')).toBeTruthy();
  });
});

jest.mock('expo-secure-store', () => {
  const values = new Map<string,string>();
  return {getItemAsync:jest.fn(async (key:string) => values.get(key) ?? null),setItemAsync:jest.fn(async (key:string,value:string) => {values.set(key,value);})};
});
