import { AppState } from 'react-native';
import { watchJobUpdates } from '@/core/jobs/jobClient';
import { ProjectService } from '@/core/projects/projectService';

/** Resume persisted work independently of which screen happens to be mounted. */
export function startWorkstationLifecycle(service = new ProjectService()): () => void {
  let active = true;
  let running = false;
  let again = false;
  const recover = async () => {
    if (!active) return;
    if (running) { again = true; return; }
    running = true;
    try {
      do { again = false; await service.reconcileOnResume(); } while (active && again);
    } catch {
      // Persisted state remains pending. Reconnect/resume is the retry boundary.
    } finally { running = false; }
  };
  const jobs = watchJobUpdates(({summary}) => {
    if (summary.observationsPending || ['completed', 'failed', 'cancelled'].includes(summary.status)) void recover();
  });
  const state = AppState.addEventListener('change', (next) => { if (next === 'active') void recover(); });
  void recover();
  return () => { active = false; jobs?.remove(); state.remove(); };
}
