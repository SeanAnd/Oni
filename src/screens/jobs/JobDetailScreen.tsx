import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { cancelJob, watchJobUpdates } from '@/core/jobs/jobClient';
import { loadJobDetail } from '@/core/jobs/jobHistoryService';
import { canCancelJob, jobStatusLabel, resultStateLabel } from '@/core/jobs/jobPresentation';
import { ingestCompletedNmapJob } from '@/core/integrations/nmap/nmapResultIngestion';
import type { JobSummary } from '@/core/models/job.model';
import { ProjectService } from '@/core/projects/projectService';
import { Screen, PageHeader, Body } from '@/components/Screen';
import { ActionButton } from '@/components/ActionButton';
import { useTheme } from '@/components/ThemeProvider';
import { remediationForErrorKey } from '@/core/security/errorRemediation';
export function JobDetailScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [service] = useState(() => new ProjectService());
  const [job, setJob] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'Overview' | 'Results' | 'Artifacts'>('Overview');
  const [technical, setTechnical] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useFocusEffect(useCallback(() => {
    let active = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      try { const detail = typeof jobId === 'string' ? await loadJobDetail(jobId) : null; if (active && request === generation) setJob(detail); }
      catch { if (active) setMessage('Job detail could not be loaded.'); }
      finally { if (active) setLoading(false); }
    };
    setJob(null); setLoading(true); void refresh();
    const subscription = watchJobUpdates(({ summary }) => { if (summary.id === jobId) void refresh(); });
    return () => { active = false; subscription?.remove(); };
  }, [jobId]));
  async function retry() {
    if (!job) return;
    setBusy(true);
    try { await ingestCompletedNmapJob(job, { projectService: service, retry: true }); setJob(await loadJobDetail(job.id)); }
    catch { setMessage('Processing retry failed. The scan and retained artifacts are unchanged.'); }
    finally { setBusy(false); }
  }
  return <Screen><PageHeader title={job?.type ?? 'Job detail'} subtitle="Execution and evidence" />
    {loading ? <Body>Loading job…</Body> : !job ? <Body>Job not found.</Body> : <>
      <View style={{ backgroundColor: colors.terminalBackground, padding: 16, borderRadius: 12, gap: 16 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{(['Overview', 'Results', 'Artifacts'] as const).map(name => <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: tab === name }} onPress={() => setTab(name)} style={{ minHeight: 48, padding: 12, borderBottomWidth: 2, borderColor: tab === name ? colors.accentBright : 'transparent' }}><Text style={{ color: colors.surfaceText }}>{name}</Text></Pressable>)}</View>
        {tab === 'Overview' && <><Text style={{ color: colors.terminalText, fontSize: 18 }}>{jobStatusLabel(job)}</Text><Text style={{ color: colors.terminalMuted }}>{job.providerId}</Text>{job.errorKey && <Text style={{ color: colors.terminalText }}>{remediationForErrorKey(job.errorKey)}</Text>}{job.progress != null && <Text style={{ color: colors.terminalText }}>Progress: {Math.round(job.progress * 100)}%</Text>}</>}
        {tab === 'Results' && <><Text style={{ color: colors.terminalText }}>{resultStateLabel(job)}</Text>{job.processing?.detail && <Text style={{ color: colors.terminalText }}>{job.processing.detail}</Text>}{job.processing && <Text style={{ color: colors.terminalMuted }}>Attempts: {job.processing.attemptCount}</Text>}</>}
        {tab === 'Artifacts' && <>{job.artifactIds.length === 0 && <Text style={{ color: colors.terminalText }}>No artifacts recorded.</Text>}{job.artifactIds.map(id => <ActionButton key={id} label={id} onPress={() => router.push({ pathname: '/artifacts/[artifactId]', params: { artifactId: id, projectId: job.projectId } })} />)}</>}
      </View>
      {job.processing?.state === 'failed' && <><Body>{resultStateLabel(job)}</Body><ActionButton label="Retry processing" disabled={busy} onPress={() => void retry()} /></>}
      {canCancelJob(job) && <ActionButton label="Request cancellation" disabled={busy} onPress={() => {
        setBusy(true); void cancelJob(job.id).then(result => setMessage(result ? 'Cancellation requested.' : 'Cancellation failed. Refresh job status.')).catch(() => setMessage('Cancellation request failed.')).finally(() => setBusy(false));
      }} />}
      <ActionButton label={technical ? 'Hide technical details' : 'Technical details'} variant="outline" onPress={() => setTechnical(value => !value)} />
      {technical && <><Body>ID: {job.id}</Body><Body>Exit code: {job.exitCode ?? 'Not recorded'}</Body><Body>Artifact hash: {job.processing?.artifactHash ?? 'Not recorded'}</Body></>}
      {message && <Body>{message}</Body>}
    </>}
  </Screen>;
}
