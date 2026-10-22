import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { listJobSummaries, reconcileJobs } from '@/core/jobs/jobClient';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';
import { taskForSetupJob } from '@/core/models/setupTimeline.model';
import { readOnboardingProgress, type OnboardingProgressState } from '@/core/state/onboardingProgress';
import type { JobSummary } from '@/core/models/job.model';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';

/** Observe existing work after navigation/restart. This never enqueues an installer. */
export function useSetupObservation(profile: EnvironmentProfileId, onProgress: (value: OnboardingProgressState) => void) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [now, setNow] = useState(Date.now);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    let pending = false;
    let foreground = AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
    const refresh = async () => {
      if (!alive || !foreground || pending) return;
      pending = true;
      try {
        const [rows, progress] = await Promise.all([listJobSummaries(SYSTEM_PROJECT_ID, 100), readOnboardingProgress(profile)]);
        if (alive && foreground) { setJobs(rows.filter(job => taskForSetupJob(job))); onProgress(progress); setUnavailable(false); setNow(Date.now()); }
      } catch { if (alive) setUnavailable(true); }
      finally { pending = false; }
    };
    void reconcileJobs().then(refresh).catch(() => { void refresh(); });
    const timer = setInterval(() => { void refresh(); }, 1000);
    const subscription = AppState.addEventListener('change', state => {
      foreground = state === 'active';
      if (foreground) { void reconcileJobs().then(refresh).catch(() => { void refresh(); }); }
    });
    return () => { alive = false; clearInterval(timer); subscription.remove(); };
  }, [profile, onProgress]);
  return {jobs, now, unavailable};
}
