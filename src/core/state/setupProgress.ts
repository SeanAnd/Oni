import { projectSetupTasks } from '@/core/models/setupTimeline.model';
import { ONBOARDING_STEPS, type OnboardingStepId } from '@/core/models/onboardingForm.model';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
export function applicableOnboardingSteps(_profile: EnvironmentProfileId): OnboardingStepId[] {
  return [...ONBOARDING_STEPS];
}
export function projectSetupProgress(completed: readonly OnboardingStepId[], profile: EnvironmentProfileId, current: OnboardingStepId) {
  const required: OnboardingStepId[] = applicableOnboardingSteps(profile).filter(step => step !== 'complete');
  const done = new Set(completed);
  const count = required.filter(step => done.has(step)).length;
  return { count, total: required.length, fraction: count / required.length, milestones: projectSetupTasks({progress:{completedSteps:[...completed],onboardingComplete:false},current,busy:false,jobs:[],now:0}).map(task => ({label:task.title,status:done.has(task.id)?'Complete':task.id===current?'Current':'Pending'})) };
}
