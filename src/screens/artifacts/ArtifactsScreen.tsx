import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { ProjectService } from '@/core/projects/projectService';
import type { Artifact } from '@/core/models/artifact.model';
import { ScreenFrame, PageHeader, Body } from '@/components/Screen';
import { useTheme } from '@/components/ThemeProvider';
import { ActionButton } from '@/components/ActionButton';
export function ArtifactsScreen() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [service] = useState(() => new ProjectService());
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [message, setMessage] = useState('Loading artifacts…');
  useFocusEffect(useCallback(() => {
    let active = true;
    setArtifacts([]);
    void (async () => {
      if (projectId !== undefined && typeof projectId !== 'string') { if (active) setMessage('Project not found.'); return; }
      const id = typeof projectId === 'string' ? projectId : await service.getActiveProjectId();
      const detail = id ? await service.getProjectDetail(id) : null;
      if (active) { setArtifacts(detail?.artifacts ?? []); setMessage(!id ? 'Choose a project to view its artifacts.' : detail ? `${detail.project?.name} · recorded scan evidence` : 'Project not found.'); }
    })().catch(() => { if (active) setMessage('Artifacts could not be loaded.'); });
    return () => { active = false; };
  }, [projectId, service]));
  return <ScreenFrame><FlatList data={artifacts} keyExtractor={item => item.id} contentContainerStyle={{ padding: 22, gap: 12, paddingBottom: 40 }} ListHeaderComponent={<View style={{ gap: 16 }}><PageHeader title="Artifacts" subtitle="Evidence, preserved." /><Body>{message}</Body><ActionButton label="Choose project" variant="outline" onPress={() => router.push('/projects')} /></View>} ListEmptyComponent={<Body muted>No artifacts recorded.</Body>}
    renderItem={({ item }) => <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/artifacts/[artifactId]', params: { artifactId: item.id, projectId: item.projectId } })} style={{ minHeight: 96, padding: 16, backgroundColor: colors.surface, borderRadius: 12, gap: 8 }}><Text style={{ color: colors.surfaceText, fontSize: 18 }}>{item.type}</Text><Text style={{ color: colors.surfaceMuted }}>{item.source} · {item.size} bytes</Text><Text style={{ color: colors.surfaceMuted }}>{item.createdAt}</Text></Pressable>} /></ScreenFrame>;
}
