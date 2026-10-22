import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ProjectService } from '@/core/projects/projectService';
import type { Artifact } from '@/core/models/artifact.model';
import { Screen, PageHeader, Body, SectionTitle } from '@/components/Screen';
import { ActionButton } from '@/components/ActionButton';
import { useTheme } from '@/components/ThemeProvider';
export function ArtifactDetailScreen() {
  const { projectId, artifactId } = useLocalSearchParams<{ projectId: string; artifactId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [service] = useState(() => new ProjectService());
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [loading, setLoading] = useState(true);
  useFocusEffect(useCallback(() => {
    let active = true;
    setArtifact(null); setLoading(true);
    void (async () => {
      const project = typeof projectId === 'string' && typeof artifactId === 'string' ? await service.getProjectDetail(projectId) : null;
      if (active) setArtifact(project?.artifacts.find(item => item.id === artifactId) ?? null);
    })().catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, artifactId, service]));
  return <Screen><PageHeader title="Artifact detail" />{loading ? <Body>Loading artifact…</Body> : !artifact ? <Body>Artifact not found in this project.</Body> : <>
    <SectionTitle>{artifact.type}</SectionTitle><Body>{artifact.mimeType} · {artifact.size} bytes</Body><Body>Source: {artifact.source}</Body><Body>Recorded: {artifact.createdAt}</Body>
    <SectionTitle>Recorded SHA-256</SectionTitle><Text selectable style={{ color: colors.text, fontFamily: 'monospace', fontSize: 14 }}>{artifact.hash}</Text><Body muted>Recorded during ingestion. This is not a fresh check of the file bytes.</Body>
    {artifact.jobId && <ActionButton label="View producing job" onPress={() => router.push({ pathname: '/jobs/[jobId]', params: { jobId: artifact.jobId! } })} />}
  </>}</Screen>;
}
