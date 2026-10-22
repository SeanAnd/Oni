import { projectSetupReadiness, setupAccess, type SetupReadiness } from '@/core/models/setupReadiness.model';
import { readOnboardingProgressResult, subscribeOnboardingWrites, type OnboardingReadResult } from './onboardingProgress';

export function createSetupReadinessStore(read: () => Promise<OnboardingReadResult>) {
  let snapshot: SetupReadiness = { status: 'loading' };
  let revision = 0;
  let pending: Promise<SetupReadiness> | undefined;
  const listeners = new Set<() => void>();
  const refresh = (): Promise<SetupReadiness> => {
    if (pending) return pending;
    pending = (async () => {
      for (;;) {
        const requested = revision;
        const result = await read().catch(() => ({status:'unavailable', reason:'storage'} as const));
        if (requested !== revision) continue;
        snapshot = projectSetupReadiness(result);
        listeners.forEach(listener => listener());
        return snapshot;
      }
    })().finally(() => { pending = undefined; });
    return pending;
  };
  return { getSnapshot: () => snapshot, refresh,
    invalidate: () => { revision++; return refresh(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export const setupReadiness = createSetupReadinessStore(() => readOnboardingProgressResult('termux-local'));
subscribeOnboardingWrites(() => { void setupReadiness.invalidate(); });
export async function checkSetupAccess() { return setupAccess(await setupReadiness.refresh()); }
export async function requireSetupAccess() {
  const access = await checkSetupAccess();
  if (!access.allowed) throw Object.assign(new Error(access.detail), { errorKey: access.errorKey });
}
