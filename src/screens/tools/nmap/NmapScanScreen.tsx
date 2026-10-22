import { ThemedToggle } from '@/components/themed-toggle/ThemedToggle';
import { useSetupGate } from '@/components/setup/useSetupGate';
import { SetupStatusNotice } from '@/components/setup/SetupStatusNotice';
import { FormInput as TextInput } from '@/components/FormInput';
import { useFocusEffect, useRouter } from 'expo-router';
import { newEntityId } from '@/core/storage/ids';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ActionButton } from '@/components/ActionButton';
import { StatusRow } from '@/components/StatusRow';
import { defaultCapabilityResolver } from '@/core/capabilities/resolver';
import { getJobSummary, watchJobUpdates } from '@/core/jobs/jobClient';
import { NmapScanOrchestrator } from '@/core/integrations/nmap/nmapScanOrchestrator';
import {
  createNmapScanFormValue,
  nmapScanFormResolver,
  validateNmapScanFormValue,
  type NmapScanFormValue,
} from '@/core/models/nmapScanForm.model';
import type { JobSummary } from '@/core/models/job.model';
import { ProjectService } from '@/core/projects/projectService';
import { remediationForErrorKey } from '@/core/security/errorRemediation';
import type { SkidErrorKey } from '@/core/security/errorKeys';
import type { HostViewModel, ServiceViewModel } from '@/core/storage/observationRepository';
import type { WorkstationTheme } from '@/theme/tokens';
import { useTheme, useThemedStyles } from '@/components/ThemeProvider';
import { Screen, PageHeader } from '@/components/Screen';

const fieldMessages: Record<string, string> = {
  NMAP_TARGET_REQUIRED: 'Enter an IPv4 address or CIDR target.',
  NMAP_TARGET_INVALID: 'Use numeric IPv4 or CIDR notation only.',
  NMAP_TARGET_TOO_LARGE: 'Target expands to more than 16 addresses.',
  NMAP_PORTS_REQUIRED: 'Enter at least one TCP port.',
  NMAP_PORTS_INVALID: 'Ports must be comma-separated values or ranges (for example 22,80,443).',
  NMAP_PORTS_TOO_MANY: 'Choose 32 ports or fewer.',
  NMAP_TIMEOUT_INVALID: 'Timeout must be between 15s and 180s.',
  NMAP_NO_ACTIVE_PROJECT: 'Create or select a project before scanning.',
};

function fieldMessage(key?: string): string | undefined {
  return key ? fieldMessages[key] ?? key : undefined;
}



function statusLabel(status: JobSummary['status']): string {
  return status.replace(/_/g, ' ');
}

export function NmapScanScreen() {
  const router = useRouter();
  const scanTrigger = useRef<View>(null);
  const checkSetup = useSetupGate(scanTrigger);
  const initialCheck = useRef(checkSetup);
  useEffect(() => { void initialCheck.current(); }, []);
  const { theme } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [projectService] = useState(() => new ProjectService());
  const [orchestrator] = useState(() => new NmapScanOrchestrator());
  const projectRef = useRef<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('None selected');
  const [capabilityDetail, setCapabilityDetail] = useState<string | undefined>();
  const [capabilityOk, setCapabilityOk] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeJob, setActiveJob] = useState<JobSummary | null>(null);
  const activeJobId = activeJob?.id;
  const [ingestMessage, setIngestMessage] = useState<string | null>(null);
  const [ingestErrorKey, setIngestErrorKey] = useState<SkidErrorKey | undefined>();
  const [resultsReady, setResultsReady] = useState(false);
  const [hosts, setHosts] = useState<HostViewModel[]>([]);
  const [services, setServices] = useState<ServiceViewModel[]>([]);

  const resolverContext = useMemo(
    () => ({ projectId: activeProjectId }),
    [activeProjectId],
  );

  const form = useForm<NmapScanFormValue>({
    defaultValues: createNmapScanFormValue(),
    resolver: nmapScanFormResolver(resolverContext),
    mode: 'onChange',
  });

  const refreshProjectContext = useCallback(async (isCurrent: () => boolean = () => true) => {
    const projectId = await projectService.getActiveProjectId();
    const detail = projectId ? await projectService.getProjectDetail(projectId) : null;
    if (!isCurrent()) return;
    if (projectRef.current !== projectId) {
      setActiveJob(null); setResultsReady(false); setIngestMessage(null); setIngestErrorKey(undefined);
    }
    projectRef.current = projectId;
    setActiveProjectId(projectId);
    setProjectName(detail?.project?.name ?? 'None selected');
    setHosts(detail?.hosts ?? []);
    setServices(detail?.services ?? []);
  }, [projectService]);

  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setLoading(true);
        await refreshProjectContext(() => !cancelled);
        const projectId = await projectService.getActiveProjectId();
        const resolution = await defaultCapabilityResolver.resolve({
          capabilityId: 'network.service_detection',
          projectId: projectId ?? '',
        });
        if (cancelled) {
          return;
        }
        setCapabilityOk(Boolean(resolution.resolved && resolution.availability?.available));
        const metadata = resolution.availability?.metadata;
        const versionHint =
          metadata && typeof metadata.version === 'string' ? metadata.version : undefined;
        setCapabilityDetail(
          resolution.availability?.reasons[0]?.detail ?? versionHint ?? resolution.errorKey,
        );
        setLoading(false);
      })();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshProjectContext, projectService]));

  useEffect(() => {
    const timer = setTimeout(() => {
      form.clearErrors();
      void form.trigger();
    }, 0);
    return () => clearTimeout(timer);
  }, [activeProjectId, form]);

  useEffect(() => {
    if (!activeJobId) {
      return undefined;
    }
    let cancelled = false;
    let receivedUpdate = false;
    const subscription = watchJobUpdates((event) => {
      if (cancelled || event.summary.id !== activeJobId) {
        return;
      }
      receivedUpdate = true;
      setActiveJob(event.summary);
    });
    // Dispatch can advance before this effect subscribes. Read after subscribing,
    // but never let a delayed snapshot overwrite a newer event.
    void getJobSummary(activeJobId).then((summary) => {
      if (!cancelled && !receivedUpdate && summary) setActiveJob(summary);
    });
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [activeJobId]);

  useEffect(() => {
    if (!activeJob || activeJob.status !== 'completed' || resultsReady) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const ingest = await orchestrator.ingestWhenReady(activeJob, {
        targetHint: form.getValues('target').trim(),
      });
      if (cancelled) {
        return;
      }
      if (!ingest.ok) {
        setIngestErrorKey((ingest.errorKey as SkidErrorKey | undefined) ?? 'PARSER_FAILED');
        setIngestMessage(
          ingest.parseOutcome?.status === 'truncated'
            ? 'Scan finished but XML looks truncated. Raw XML was saved.'
            : remediationForErrorKey(ingest.errorKey as SkidErrorKey | undefined, ingest.detail),
        );
        setResultsReady(false);
        return;
      }
      setIngestErrorKey(undefined);
      setIngestMessage('Results verified and ingested for this project.');
      setResultsReady(true);
      if (activeProjectId) {
        const detail = await projectService.getProjectDetail(activeProjectId);
        setHosts(detail?.hosts ?? []);
        setServices(detail?.services ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeJob, activeProjectId, form, orchestrator, projectService, resultsReady]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!(await checkSetup())) return;
    setSubmitting(true);
    setIngestMessage(null);
    setIngestErrorKey(undefined);
    setResultsReady(false);
    setActiveJob(null);

    const validated = validateNmapScanFormValue(values, resolverContext);
    if (!validated.ok || !validated.executionParams) {
      setSubmitting(false);
      return;
    }

    const jobId = newEntityId('nmap');
    const started = await orchestrator.startScan(jobId, validated.executionParams);
    setSubmitting(false);
    if (!started.ok) {
      setIngestErrorKey(started.errorKey as SkidErrorKey | undefined);
      setIngestMessage(remediationForErrorKey(started.errorKey as SkidErrorKey | undefined, started.detail));
      return;
    }

    const summary = await getJobSummary(started.jobId ?? jobId);
    setActiveJob(summary);
    setIngestMessage('Scan queued. Results appear after verified artifact transfer and ingest.');
  });

  const scanComplete = activeJob?.status === 'completed';
  const scanFailed = activeJob?.status === 'failed' || activeJob?.status === 'cancelled';
  const showSummaries = resultsReady && scanComplete;

  return (
    <Screen>
        <PageHeader title="Scan network" subtitle="Nmap service discovery" /><SetupStatusNotice /><Text style={styles.intro}>Project: {projectName}</Text>
        <Text style={styles.intro}>
          Discover services on up to 16 IPv4 addresses and 32 TCP ports. Uses a rootless TCP connect scan with verified XML results.
        </Text>

        {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
        <StatusRow
          label="network.service_detection"
          detail={
            activeProjectId
              ? capabilityDetail ?? (capabilityOk ? 'Provider ready' : 'Provider unavailable')
              : 'Select a project first'
          }
          ok={Boolean(activeProjectId && capabilityOk)}
        />

        <View style={styles.field}>
          <Text style={styles.label}>Target (IPv4 or CIDR)</Text>
          <Controller
            control={form.control}
            name="target"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                accessibilityLabel="Scan target"
                autoCapitalize="none"
                autoCorrect={false}
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="192.168.1.10 or 10.0.0.0/28"
                placeholderTextColor={theme.colors.surfaceMuted}
                style={styles.input}
                value={value}
              />
            )}
          />
          {form.formState.errors.target ? (
            <Text style={styles.error}>{fieldMessage(form.formState.errors.target.message)}</Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Ports</Text>
          <Controller
            control={form.control}
            name="ports"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                accessibilityLabel="Scan ports"
                autoCapitalize="none"
                autoCorrect={false}
                onBlur={onBlur}
                onChangeText={onChange}
                placeholder="22,80,443"
                placeholderTextColor={theme.colors.surfaceMuted}
                style={styles.input}
                value={value}
              />
            )}
          />
          {form.formState.errors.ports ? (
            <Text style={styles.error}>{fieldMessage(form.formState.errors.ports.message)}</Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Controller
            control={form.control}
            name="serviceDetection"
            render={({ field: { onChange, value } }) => (
              <ThemedToggle label="Service detection" accessibilityHint="Detect service versions using Nmap -sV" onValueChange={onChange} value={value} />
            )}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Timeout (ms)</Text>
          <Controller
            control={form.control}
            name="timeoutMs"
            render={({ field: { onChange, onBlur, value } }) => (
              <TextInput
                accessibilityLabel="Scan timeout milliseconds"
                keyboardType="number-pad"
                onBlur={onBlur}
                onChangeText={(text) => onChange(Number.parseInt(text, 10) || 0)}
                style={styles.input}
                value={String(value)}
              />
            )}
          />
          {form.formState.errors.timeoutMs ? (
            <Text style={styles.error}>{fieldMessage(form.formState.errors.timeoutMs.message)}</Text>
          ) : null}
        </View>

        {form.formState.errors.root ? (
          <Text style={styles.error}>{fieldMessage(form.formState.errors.root.message)}</Text>
        ) : null}

        <ActionButton
          buttonRef={scanTrigger}
          label={submitting ? 'Starting scan…' : 'Run scan'}
          disabled={submitting || !activeProjectId || !capabilityOk || !form.formState.isValid}
          onPress={() => void onSubmit()}
        />

        {activeJob ? (
          <View style={styles.panel}>
            <ActionButton label="View job" onPress={() => router.push({ pathname: '/jobs/[jobId]', params: { jobId: activeJob.id } })} />
            <Text style={styles.panelTitle}>Job</Text>
            <Text style={styles.body}>ID: {activeJob.id}</Text>
            <Text style={styles.body}>Status: {statusLabel(activeJob.status)}</Text>
            {activeJob.progress !== undefined ? (
              <Text style={styles.body}>Progress: {Math.round((activeJob.progress ?? 0) * 100)}%</Text>
            ) : null}
            {activeJob.artifactIds.length > 0 ? (
              <Text style={styles.body}>Artifacts: {activeJob.artifactIds.join(', ')}</Text>
            ) : null}
            {scanFailed && activeJob.errorKey ? (
              <Text style={styles.error}>{remediationForErrorKey(activeJob.errorKey, undefined)}</Text>
            ) : null}
            {scanComplete && !resultsReady && !ingestErrorKey ? (
              <Text style={styles.muted}>Waiting for verified artifact transfer and ingest…</Text>
            ) : null}
          </View>
        ) : null}

        {ingestMessage ? <Text style={scanFailed || ingestErrorKey ? styles.error : styles.intro}>{ingestMessage}</Text> : null}

        {showSummaries ? (
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>Hosts</Text>
            {hosts.length === 0 ? <Text style={styles.muted}>No host observations ingested.</Text> : null}
            {hosts.map((host) => (
              <Text key={`${host.targetId}-${host.address}`} style={styles.body}>
                {host.address} · {host.status ?? 'unknown'}
              </Text>
            ))}
            <Text style={[styles.panelTitle, styles.sectionGap]}>Services</Text>
            {services.length === 0 ? <Text style={styles.muted}>No services recorded.</Text> : null}
            {services.map((service) => (
              <Text key={`${service.address}-${service.port}`} style={styles.body}>
                {service.address}:{service.port} {service.product ?? ''}
              </Text>
            ))}
          </View>
        ) : null}
      </Screen>
  );
}

const createStyles = (theme: WorkstationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md, paddingBottom: theme.spacing.xl },
  title: { color: theme.colors.text, fontSize: theme.type.title, fontWeight: '700' },
  intro: { color: theme.colors.muted, fontSize: theme.type.body, lineHeight: 22 },
  field: { gap: theme.spacing.xs },
  label: { color: theme.colors.text, fontSize: theme.type.body, fontWeight: '600' },
  input: {
    borderRadius: theme.radius.control,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    color: theme.colors.surfaceText,
    minHeight: 56,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontSize: theme.type.body,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  error: { color: theme.colors.error, fontSize: theme.type.body },
  muted: { color: theme.colors.surfaceMuted, fontSize: theme.type.body },
  body: { color: theme.colors.surfaceText, fontSize: theme.type.body },
  panel: {
    padding: theme.spacing.md,
    borderRadius: theme.radius.panel,
    backgroundColor: theme.colors.surface,
    gap: theme.spacing.xs,
  },
  panelTitle: { color: theme.colors.accentBright, fontWeight: '600' },
  sectionGap: { marginTop: theme.spacing.sm },
});
