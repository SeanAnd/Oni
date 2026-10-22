import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { watchJobUpdates } from '@/core/jobs/jobClient';
import { loadJobSummaries } from '@/core/jobs/jobHistoryService';
import { jobStatusLabel, mergeJobSummaries } from '@/core/jobs/jobPresentation';
import type { JobSummary } from '@/core/models/job.model';
import { ProjectService } from '@/core/projects/projectService';
import { ScreenFrame, PageHeader, Body } from '@/components/Screen';
import { useTheme } from '@/components/ThemeProvider';
export function JobsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const [service] = useState(() => new ProjectService());
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [message, setMessage] = useState('Loading job history…');
  useFocusEffect(useCallback(() => {
    let active = true;
    let loading = false;
    let again = false;
    const refresh = async () => {
      if (loading) { again = true; return; }
      loading = true;
      try {
        do {
          again = false;
          if (projectId !== undefined && typeof projectId !== 'string') { if (active) { setJobs([]); setMessage('Project not found.'); } return; }
          const id = typeof projectId === 'string' ? projectId : await service.getActiveProjectId();
          if (projectId && (!id || !await service.getProjectDetail(id))) { if (active) { setJobs([]); setMessage('Project not found.'); } return; }
          const list = await loadJobSummaries(id ?? undefined);
          if (active) { setJobs(mergeJobSummaries(list)); setMessage(id ? 'Project history and workstation maintenance.' : 'All projects and workstation maintenance.'); }
        } while (active && again);
      } catch { if (active) setMessage('Job history could not be loaded. Reopen Jobs to retry.'); }
      finally { loading = false; }
    };
    void refresh();
    const subscription = watchJobUpdates(() => { if (active) void refresh(); });
    return () => { active = false; subscription?.remove(); };
  }, [projectId, service]));
  return <ScreenFrame><FlatList data={jobs} keyExtractor={job => job.id} contentContainerStyle={{ padding: 22, gap: 12, paddingBottom: 40 }}
    ListHeaderComponent={<View style={{ gap: 16 }}><PageHeader title="Jobs" subtitle="Work continues when you leave." /><Body muted>{message}</Body></View>}
    ListEmptyComponent={<Body muted>No jobs recorded yet.</Body>}
    renderItem={({ item: job }) => <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/jobs/[jobId]', params: { jobId: job.id } })} style={{ minHeight: 96, padding: 16, backgroundColor: colors.surface, borderRadius: 12, gap: 8 }}>
      <Text style={{ color: colors.surfaceText, fontSize: 20 }}>{job.type}</Text><Text style={{ color: colors.surfaceMuted }}>{jobStatusLabel(job)} · {job.projectId === 'system-onboarding' ? 'Workstation' : 'Project'}</Text>
      {job.processing?.state === 'failed' && <Text style={{ color: colors.surfaceText }}>Results need attention</Text>}
      <Text style={{ color: colors.surfaceMuted }}>{job.finishedAt ?? job.startedAt ?? 'Queued'}</Text>
    </Pressable>} /></ScreenFrame>;
}
