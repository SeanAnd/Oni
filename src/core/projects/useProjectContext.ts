import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { ProjectService } from './projectService';
import type { ProjectSummary } from '@/core/storage/projectRepository';
/** Re-read durable selection whenever navigation returns to a consuming screen. */
export function useProjectContext() {
  const [service] = useState(() => new ProjectService());
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const [error, setError] = useState(false);
  useFocusEffect(useCallback(() => {
    // Read the invalidation signal to refresh after local mutations as well as focus.
    void revision;
    let active = true;
    setLoading(true);
    void Promise.all([service.listProjectSummaries(), service.getActiveProjectId()]).then(([list, id]) => {
      if (active) { setProjects(list); setActiveId(id); setError(false); }
    }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [service, revision]));
  return { projects, activeId, activeProject: projects.find(project => project.id === activeId), loading, error, service, refresh };
}
