import { SETUP_TASKS, type SetupTaskId } from './setupTask.model';
import type { OnboardingReadResult } from '@/core/state/onboardingProgress';

export type SetupReadiness = { status: 'loading' } | { status: 'unavailable' } | {
  status: 'incomplete' | 'complete'; completed: number; required: number; nextTask?: SetupTaskId;
};
export function projectSetupReadiness(result: OnboardingReadResult): SetupReadiness {
  if (result.status === 'unavailable') return { status: 'unavailable' };
  const completed = SETUP_TASKS.filter(task => result.progress.completedSteps.includes(task)).length;
  return { status: completed === SETUP_TASKS.length ? 'complete' : 'incomplete', completed, required: SETUP_TASKS.length,
    nextTask: SETUP_TASKS.find(task => !result.progress.completedSteps.includes(task)) };
}
export type SetupAccess = {allowed:true} | {allowed:false;errorKey:'SETUP_REQUIRED' | 'SETUP_STATUS_UNAVAILABLE';detail:string};
export function setupAccess(state: SetupReadiness): SetupAccess {
  if (state.status === 'complete') return { allowed: true } as const;
  return { allowed: false, errorKey: state.status === 'incomplete' ? 'SETUP_REQUIRED' : 'SETUP_STATUS_UNAVAILABLE',
    detail: state.status === 'incomplete' ? 'Finish Setup before starting this action.' : 'Setup status could not be checked. Retry or open Setup.' } as const;
}
