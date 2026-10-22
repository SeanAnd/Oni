import { render, screen } from '@testing-library/react-native';
import { HomeScreen } from './HomeScreen';
jest.mock('@/core/projects/useProjectContext', () => ({ useProjectContext: () => ({activeId: 'p', activeProject: {name: 'Local work', targetCount: 1, observationCount: 2, artifactCount: 1}, loading: false, error: false}) }));
jest.mock('@/core/integrations/system/environmentSnapshot', () => ({refreshEnvironmentSample: () => new Promise(() => {})}));
jest.mock('@/core/state/onboardingProgress', () => ({subscribeOnboardingWrites: () => () => {}, readOnboardingProgressResult: async () => ({status:'found', progress:{completedSteps:[], onboardingComplete:false}})}));
jest.mock('@/core/jobs/jobHistoryService', () => ({loadJobSummaries: async () => []}));
it('keeps local work and setup accessible while Framework is slow', async () => {
  await render(<HomeScreen />);
  expect(screen.getByText('Local work')).toBeOnTheScreen();
  expect(screen.getByText('Checking environment…')).toBeOnTheScreen();
  expect(await screen.findByRole('button', {name: 'Open Setup'})).toBeOnTheScreen();
});
