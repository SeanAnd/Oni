import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AccessibilityInfo, findNodeHandle, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { createProjectFormValue, projectFormResolver, type ProjectFormValue } from '@/core/models/projectForm.model';
import { useProjectContext } from '@/core/projects/useProjectContext';
import { ScreenFrame, PageHeader, Body } from '@/components/Screen';
import { ActionButton } from '@/components/ActionButton';
import { useTheme } from '@/components/ThemeProvider';
import { CreateProjectModal } from './CreateProjectModal';
import { ActiveProjectBadge } from './ActiveProjectBadge';

export function ProjectsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { projects, activeId, loading, error, service, refresh } = useProjectContext();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [message, setMessage] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const trigger = useRef<View>(null);
  const form = useForm<ProjectFormValue>({ defaultValues: createProjectFormValue(), resolver: projectFormResolver({ nameTaken: () => false }), mode: 'onChange' });
  function dismiss() {
    if (saving.current) return;
    setVisible(false); form.reset(createProjectFormValue()); setMessage('');
    setTimeout(() => { if (!trigger.current) return; const handle = findNodeHandle(trigger.current); if (handle) AccessibilityInfo.setAccessibilityFocus(handle); }, 350);
  }
  const submit = () => form.handleSubmit(async values => {
    if (saving.current) return;
    saving.current = true; setBusy(true); setMessage('');
    try {
      const result = await service.createProject(values);
      if (!result.ok) {
        for (const field of ['name', 'description'] as const) if (result.fieldErrors?.[field]) form.setError(field, { message: result.fieldErrors[field] });
        setMessage(result.formError ? 'Project could not be created. Review the fields.' : '');
        return;
      }
      saving.current = false; dismiss(); refresh();
    } catch { setMessage('Project could not be saved. Try again.'); }
    finally { saving.current = false; setBusy(false); }
  })();
  async function select(id: string) {
    setSelectionError('');
    try { if (await service.setActiveProject(id)) refresh(); else setSelectionError('Project could not be selected. Try again.'); }
    catch { setSelectionError('Project could not be selected. Try again.'); }
  }
  return <ScreenFrame>
    <View style={{ padding: 22, gap: 12 }}>
      <PageHeader title="Projects" subtitle="A place for every investigation." />
      <ActionButton buttonRef={trigger} label="+ New project" onPress={() => setVisible(true)} />
      <Body muted>{loading ? 'Loading projects…' : error ? 'Projects could not be loaded.' : 'Select a project to scope your next scan.'}</Body>
      {!!selectionError && <Text accessibilityRole="alert" style={{ color: colors.error }}>{selectionError}</Text>}
    </View>
    <FlatList data={projects} keyExtractor={item => item.id} contentContainerStyle={{ paddingHorizontal: 22, gap: 12, paddingBottom: 40 }}
      ListEmptyComponent={<Body muted>No projects yet.</Body>}
      renderItem={({ item }) => <View testID={`project-${item.id}`} accessibilityState={{ selected: activeId === item.id }} style={{ padding: 16, gap: 12, borderRadius: 12, borderWidth: 3, borderColor: activeId === item.id ? colors.selection : colors.border, backgroundColor: activeId === item.id ? colors.selectionSurface : colors.surface }}>
        {activeId === item.id && <ActiveProjectBadge />}
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.name}`} onPress={() => router.push({ pathname: '/projects/[projectId]', params: { projectId: item.id } })} style={{ minHeight: 48, justifyContent: 'center' }}>
          <Text style={{ color: colors.surfaceText, fontSize: 22 }}>{item.name}</Text>
        </Pressable>
        <Text style={{ color: colors.surfaceMuted }}>{item.targetCount} targets · {item.observationCount} findings · {item.artifactCount} artifacts</Text>
        {activeId !== item.id && <ActionButton label={`Select ${item.name}`} onPress={() => void select(item.id)} />}
      </View>} />
    <CreateProjectModal visible={visible} form={form} busy={busy} message={message} onCancel={dismiss} onSubmit={() => void submit()} />
  </ScreenFrame>;
}
