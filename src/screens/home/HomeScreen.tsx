import { View } from 'react-native';
import { SetupStatusNotice } from '@/components/setup/SetupStatusNotice';
import { useSetupGate } from '@/components/setup/useSetupGate';
import { useCallback, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen, PageHeader, Body, SectionTitle } from '@/components/Screen';
import { ActionButton } from '@/components/ActionButton';
import { ToolTile, TileGrid } from '@/components/ToolTile';
import { useProjectContext } from '@/core/projects/useProjectContext';
import { refreshEnvironmentSample, environmentSummary } from '@/core/integrations/system/environmentSnapshot';
import { loadJobSummaries } from '@/core/jobs/jobHistoryService';
import type { JobSummary } from '@/core/models/job.model';
export function HomeScreen() {
  const router = useRouter();
  const { activeProject, activeId, loading, error } = useProjectContext();
  const [health, setHealth] = useState('Checking environment…');
  const scanTrigger = useRef<View>(null);
  const checkSetup = useSetupGate(scanTrigger);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  useFocusEffect(useCallback(() => {
    let active = true;
    setHealth('Checking environment…');
    void refreshEnvironmentSample().then(({ snapshot }) => {
      if (active) setHealth(environmentSummary(snapshot));
    }).catch(() => { if (active) setHealth('Environment check unavailable. Stored work is still accessible.'); });
    return () => { active = false; };
  }, []));
  useFocusEffect(useCallback(() => {
    let active = true;
    void loadJobSummaries(activeId ?? undefined, 3).then(list => { if (active) setJobs(list.slice(0, 3)); }).catch(() => { if (active) setJobs([]); });
    return () => { active = false; };
  }, [activeId]));
  return <Screen><PageHeader title="Your workstation" subtitle={'Explore. Test. Understand.\n君の自閉症を武器化せよ'} hero />
    <SetupStatusNotice />
    <SectionTitle>{activeProject?.name ?? 'Choose your workspace'}</SectionTitle>
    <Body muted>{loading ? 'Loading projects…' : error ? 'Projects could not be loaded. Try reopening Projects.' : activeProject ? `${activeProject.targetCount} targets · ${activeProject.observationCount} findings · ${activeProject.artifactCount} artifacts` : 'Create a project to organize scans and findings.'}</Body>
    {!activeProject && <ActionButton label="Create a project" onPress={() => router.push('/projects')} />}
    <Body>{health}</Body>
    <TileGrid>
      <ToolTile buttonRef={scanTrigger} title="Scan network" detail="Nmap service discovery" icon="recon" onPress={() => { void checkSetup().then(allowed => { if (allowed) router.push('/tools/nmap'); }); }} />
      <ToolTile title="Projects" detail="Your work, organized" icon="sessions" onPress={() => router.push('/projects')} />
      <ToolTile title="Jobs" detail="Execution and results" icon="terminal" onPress={() => router.push('/jobs')} />
      <ToolTile title="Terminal" detail="Shell and Metasploit console" icon="metasploit" onPress={() => router.push('/terminal')} />
      <ToolTile title="Artifacts" detail="Evidence from your scans" icon="reports" onPress={() => router.push('/artifacts')} />
      <ToolTile title="Setup" detail="Progress and readiness" icon="nethunter" onPress={() => router.push('/onboarding')} />
    </TileGrid>
    <SectionTitle>Recent jobs</SectionTitle>
    {jobs.length === 0 ? <Body muted>No recent jobs.</Body> : jobs.map(job => <ActionButton key={job.id} variant="outline" label={`${job.type} · ${job.status.replaceAll('_', ' ')}`} onPress={() => router.push({ pathname: '/jobs/[jobId]', params: { jobId: job.id } })} />)}
  </Screen>;
}
