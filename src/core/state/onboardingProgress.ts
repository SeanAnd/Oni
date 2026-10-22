import { isSetupTask, type SetupTaskRecords, type SetupTaskId, type SetupActivity } from '@/core/models/setupTask.model';
import { applicableOnboardingSteps } from './setupProgress';
import { readEnvironmentProfile } from './environmentProfile';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
import * as SecureStore from 'expo-secure-store';

import { ONBOARDING_STEPS, type OnboardingStepId } from '@/core/models/onboardingForm.model';

const ONBOARDING_PROGRESS_KEY = 'skid.onboarding.progress';

export interface OnboardingProgressState {
  completedSteps: OnboardingStepId[];
  onboardingComplete: boolean;
  tasks?: SetupTaskRecords;
  updatedAt?: number;
}

export function createEmptyOnboardingProgress(): OnboardingProgressState {
  return {
    completedSteps: [],
    onboardingComplete: false,
  };
}

export type OnboardingReadResult = { status: 'found' | 'absent'; progress: OnboardingProgressState } | { status: 'unavailable'; reason: 'malformed' | 'storage' };
const listeners = new Set<() => void>();
export function subscribeOnboardingWrites(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function readOnboardingProgress(profileId?: EnvironmentProfileId): Promise<OnboardingProgressState> {
  const result = await readOnboardingProgressResult(profileId);
  return result.status === 'unavailable' ? createEmptyOnboardingProgress() : result.progress;
}
export async function readOnboardingProgressResult(profileId?: EnvironmentProfileId): Promise<OnboardingReadResult> {
  try {
    const profile = profileId ?? await readEnvironmentProfile();
    const key = `${ONBOARDING_PROGRESS_KEY}.${profile}.v1`;
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) {
      return {status: 'absent', progress: createEmptyOnboardingProgress()};
    }
    let parsed: Partial<OnboardingProgressState>;
    try {
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.completedSteps)) return {status:'unavailable', reason:'malformed'};
    } catch { return {status:'unavailable', reason:'malformed'}; }
    return {status: 'found', progress: {
      completedSteps: parsed.completedSteps!.filter(step => ONBOARDING_STEPS.includes(step)),
      onboardingComplete: Boolean(parsed.onboardingComplete),
      tasks: readTaskRecords(parsed.tasks),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }};
  } catch {
    return {status:'unavailable', reason:'storage'};
  }
}

export async function writeOnboardingProgress(state: OnboardingProgressState, profileId?: EnvironmentProfileId): Promise<void> {
  await SecureStore.setItemAsync(`${ONBOARDING_PROGRESS_KEY}.${profileId ?? await readEnvironmentProfile()}.v1`, JSON.stringify(state));
  listeners.forEach(listener => listener());
}

export async function markOnboardingStepComplete(step: OnboardingStepId, profileId?: EnvironmentProfileId, outcome?: string): Promise<OnboardingProgressState> {
  const profile = profileId ?? await readEnvironmentProfile();
  const result = await readOnboardingProgressResult(profile);
  if (result.status === 'unavailable') throw new Error('Setup progress could not be read; saved progress has been preserved.');
  const current = result.progress;
  const completedSteps = current.completedSteps.includes(step)
    ? current.completedSteps
    : [...current.completedSteps, step];
  const onboardingComplete = step === 'complete' || current.onboardingComplete;
  const tasks = {...current.tasks};
  if (isSetupTask(step) && tasks[step]) tasks[step] = {...tasks[step]!, finishedAt: Date.now(), outcome};
  const next = { completedSteps, onboardingComplete, tasks, updatedAt: Date.now() };
  await writeOnboardingProgress(next, profile);
  return next;
}

export function nextOnboardingStep(completed: OnboardingStepId[], profile: EnvironmentProfileId = 'termux-local'): OnboardingStepId {
  const order = applicableOnboardingSteps(profile);
  for (const step of order) {
    if (!completed.includes(step)) {
      return step;
    }
  }
  return 'complete';
}

/** Presentation checkpoints only. Native Jobs remains the execution authority. */
export async function recordSetupActivity(step: SetupTaskId, activity: SetupActivity, profileId?: EnvironmentProfileId): Promise<OnboardingProgressState> {
  const profile = profileId ?? await readEnvironmentProfile();
  const result = await readOnboardingProgressResult(profile);
  if (result.status === 'unavailable') throw new Error('Setup progress could not be read; saved progress has been preserved.');
  const current = result.progress;
  const previous = current.tasks?.[step];
  const next = {...current, updatedAt: Date.now(), tasks: {...current.tasks, [step]: {startedAt: previous && !previous.finishedAt ? previous.startedAt : Date.now(), activity}}};
  await writeOnboardingProgress(next, profile);
  return next;
}
function readTaskRecords(value: unknown): SetupTaskRecords {
  const result: SetupTaskRecords = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, record] of Object.entries(value)) {
    if (!isSetupTask(key as OnboardingStepId) || !record || typeof record !== 'object') continue;
    const p = record as Record<string, unknown>;
    if (typeof p.startedAt !== 'number' || !Number.isFinite(p.startedAt) || typeof p.activity !== 'string') continue;
    result[key as SetupTaskId] = {startedAt: p.startedAt, activity: p.activity as SetupActivity,
      finishedAt: typeof p.finishedAt === 'number' && Number.isFinite(p.finishedAt) ? p.finishedAt : undefined,
      outcome: typeof p.outcome === 'string' ? p.outcome.slice(0, 250) : undefined};
  }
  return result;
}
