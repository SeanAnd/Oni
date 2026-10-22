import { projectSetupProgress, applicableOnboardingSteps } from './setupProgress';
it('counts device prerequisites once and excludes completion from the total', () => {
  const result = projectSetupProgress(['termux', 'termux', 'complete'], 'termux-local', 'kali_health');
  expect(result.milestones).toHaveLength(6);
  expect(result.count).toBe(1);
  expect(result.total).toBe(6);
  expect(result.milestones.find(item => item.label === 'Connect Termux & Python')?.status).toBe('Complete');
});
it('completes progress after all local prerequisites', () => {
  const steps = applicableOnboardingSteps('termux-local');
  expect(projectSetupProgress(steps, 'termux-local', 'complete').fraction).toBe(1);
});
