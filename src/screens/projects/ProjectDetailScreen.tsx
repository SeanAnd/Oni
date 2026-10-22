import { useCallback, useState } from 'react';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ProjectService } from '@/core/projects/projectService';
import { Screen, PageHeader, Body, SectionTitle } from '@/components/Screen';
import { ActiveProjectBadge } from './ActiveProjectBadge';
import { ActionButton } from '@/components/ActionButton';
export function ProjectDetailScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const router = useRouter();
  const [service] = useState(() => new ProjectService());
  const [detail, setDetail] = useState<Awaited<ReturnType<ProjectService['getProjectDetail']>>>(null);
  const [loading, setLoading] = useState(true);
  const [selectionError, setSelectionError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true); setDetail(null);
    void Promise.all([typeof projectId === 'string' ? service.getProjectDetail(projectId) : null, service.getActiveProjectId()]).then(([next, id]) => { if (active) { setDetail(next); setActiveId(id); } }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, service]));
  return <Screen><PageHeader title={detail?.project?.name ?? 'Project'} />
    {loading ? <Body>Loading project…</Body> : !detail ? <Body>Project not found.</Body> : <>
      <Body>{detail.project?.description ?? 'Your project workspace.'}</Body>
      {activeId === projectId ? <ActiveProjectBadge /> : <ActionButton label="Make active" onPress={() => { void service.setActiveProject(projectId).then(ok => { if (ok) setActiveId(projectId); else setSelectionError('Project could not be selected.'); }).catch(() => setSelectionError('Project could not be selected.')); }} />}
      {!!selectionError && <Body>{selectionError}</Body>}
      <ActionButton label="Scan this project" disabled={activeId !== projectId} onPress={() => router.push('/tools/nmap')} />
      <SectionTitle>Hosts</SectionTitle>{detail.hosts.length === 0 && <Body muted>No hosts observed yet.</Body>}{detail.hosts.map((host, index) => <Body key={`${host.targetId}-${index}`}>{host.address} · {host.status ?? 'Observed'}</Body>)}
      <SectionTitle>Services</SectionTitle>{detail.services.length === 0 && <Body muted>No services observed yet.</Body>}{detail.services.map((service, index) => <Body key={`${service.targetId}-${service.port}-${index}`}>{service.address}:{service.port} · {service.product ?? service.protocol ?? 'Service'} {service.version ?? ''}</Body>)}
      <ActionButton label="Project jobs" variant="outline" onPress={() => router.push({ pathname: '/jobs', params: { projectId } })} />
      <ActionButton label={`Artifacts (${detail.artifacts.length})`} variant="outline" onPress={() => router.push({ pathname: '/artifacts', params: { projectId } })} />
    </>}
  </Screen>;
}
