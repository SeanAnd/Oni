import { ReadinessPanel } from './ReadinessPanel';
import { useSetupObservation } from './useSetupObservation';
import { SetupTaskFocus } from './SetupTaskFocus';
import { projectSetupTasks, isActiveSetupJob, taskForSetupJob } from '@/core/models/setupTimeline.model';
import type { SetupTaskId, SetupActivity } from '@/core/models/setupTask.model';
import { finishWorkstationSetup, isSavedResultsStep } from '@/core/integrations/termux/finishWorkstationSetup';
import { inspectSetup, runSetupJob, activeSetupJob, type SetupInspection } from '@/core/integrations/termux/setupService';
import { setupStepPresentation } from '@/core/models/setupPresentation.model';
import { SetupJobProgress } from './SetupJobProgress';
import { SetupHelp } from './SetupHelp';
import { OnboardingFields } from './OnboardingFields';
import { SetupTimeline } from './SetupTimeline';
import { readEnvironmentProfile } from '@/core/state/environmentProfile';
import { bootstrapWorkstation } from '@/core/integrations/termux/bootstrapService';
import { newEntityId } from '@/core/storage/ids';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { runOnboardingHealthJob } from '@/core/integrations/termux/onboardingHealthJob';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useForm, useWatch } from 'react-hook-form';
import { useRouter } from 'expo-router';

import { ActionButton } from '@/components/ActionButton';
import { getTermuxStatus, openTermuxAppSettings } from '@/core/integrations/termux/termuxBridgeClient';
import {
  createOnboardingFormValue,
  onboardingFormResolver,
  onboardingIssuesForStep,
  type OnboardingFormValue,
  type OnboardingStepId,
} from '@/core/models/onboardingForm.model';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';
import {
  markOnboardingStepComplete,
  recordSetupActivity,
  nextOnboardingStep,
  readOnboardingProgress,
  type OnboardingProgressState,
} from '@/core/state/onboardingProgress';
import { remediationForErrorKey } from '@/core/security/errorRemediation';
import type { SkidErrorKey } from '@/core/security/errorKeys';
import type { WorkstationTheme } from '@/theme/tokens';
import { useThemedStyles } from '@/components/ThemeProvider';
import { Screen, PageHeader } from '@/components/Screen';



export function OnboardingScreen() {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const form = useForm<OnboardingFormValue>({
    defaultValues: createOnboardingFormValue(),
    resolver: onboardingFormResolver(),
    mode: 'onChange',
  });
  const { control, getValues, setValue } = form;

  const [progress, setProgress] = useState<OnboardingProgressState | null>(null);
  const [activeStep, setActiveStep] = useState<OnboardingStepId>('termux');
  const [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState<SetupInspection | null>(null);
  const [showSample, setShowSample] = useState(false);
  const [stepErrorKey, setStepErrorKey] = useState<SkidErrorKey | undefined>();
  const [stepDetail, setStepDetail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const selected = await readEnvironmentProfile();
      setValue('profileId', selected);
      const stored = await readOnboardingProgress(selected);
      if (cancelled) {
        return;
      }
      setProgress(stored);
      setActiveStep(nextOnboardingStep(stored.completedSteps, selected));
      const termuxToken = await getTermuxHelperToken();
      if (!cancelled && termuxToken) setValue('termuxHelperToken', termuxToken);

    })().catch(() => { if (!cancelled) { setStepErrorKey('DATABASE_RECOVERY_REQUIRED'); setStepDetail('Local setup could not be loaded. Resolve pending device maintenance and retry.'); } });
    return () => {
      cancelled = true;
    };
  }, [setValue]);

  const profile = useWatch({control, name: 'profileId'});
  const acceptProgress = useCallback((next: OnboardingProgressState) => {
    setProgress(previous => (previous?.updatedAt ?? 0) > (next.updatedAt ?? 0) ? previous : next);
  }, []);
  const observation = useSetupObservation(profile, acceptProgress);
  const activeJob = observation.jobs.find(job => isActiveSetupJob(job) &&
    !(progress?.tasks?.[taskForSetupJob(job)!]?.finishedAt && job.startedAt &&
      Date.parse(job.startedAt) <= progress.tasks[taskForSetupJob(job)!]!.finishedAt!));
  const visibleStep = busy ? activeStep : activeJob ? taskForSetupJob(activeJob)! : progress ? nextOnboardingStep(progress.completedSteps) : activeStep;
  const tasks = projectSetupTasks({progress,current:visibleStep,busy,jobs:observation.jobs,now:observation.now,error:stepDetail ?? undefined,observationUnavailable:observation.unavailable});
  const currentTask = tasks.find(task => task.id === visibleStep);
  const setupJob = currentTask?.job?.type.startsWith('setup.') ? currentTask.job : undefined;
  const activity = async (step: SetupTaskId, phase: SetupActivity) => {
    setActiveStep(step);
    const next = await recordSetupActivity(step, phase, getValues('profileId'));
    acceptProgress(next);
  };
  const completedSet = useMemo(() => new Set(progress?.completedSteps ?? []), [progress]);

  const failStep = (key: SkidErrorKey | undefined, detail?: string) => {
    setStepErrorKey(key);
    setStepDetail(detail ?? remediationForErrorKey(key));
  };

  const completeStep = async (step: OnboardingStepId, outcome?: string) => {
    const next = await markOnboardingStepComplete(step, getValues('profileId'), outcome);
    setProgress(next);
    setInspection(null);
    setActiveStep(nextOnboardingStep(next.completedSteps, getValues('profileId')));
    setStepErrorKey(undefined);
    setStepDetail(null);
  };

  const validateCurrentStep = (): boolean => {
    const issues = onboardingIssuesForStep(getValues(), visibleStep);
    if (issues.length > 0) {
      failStep(issues[0].key);
      return false;
    }
    return true;
  };

  const runStep = async () => {
    if (!validateCurrentStep()) {
      return;
    }
    setBusy(true);
    setStepErrorKey(undefined);
    setStepDetail(null);
    try {
      if (isSavedResultsStep(visibleStep)) {
        const result = await finishWorkstationSetup(visibleStep, setActiveStep, completeStep, activity);
        if (!result.ok) { failStep(result.errorKey, result.detail); return; }
        setValue('msfDatabasePassword', '');
        await completeStep('complete');
        return;
      }
      switch (visibleStep) {
        case 'termux': {
          await activity('termux', 'checking_access');
          const status = await getTermuxStatus();
          if (!status.installed || !status.permissionGranted) {
            failStep(status.errorKey ?? 'TERMUX_NOT_INSTALLED', status.detail);
            return;
          }
          const savedJob = await activeSetupJob('python');
          if (savedJob) { const resumed = await runSetupJob('python', () => undefined); if (!resumed.ok) { failStep(resumed.errorKey, resumed.detail); return; } }
          await activity('termux', 'checking_python');
          const detected = await inspectSetup('python');
          setInspection(detected);
          if (!detected.ok) { failStep(detected.errorKey); return; }
          if (!detected.pythonReady) {
            if (!inspection || inspection.pythonReady) { await activity('termux', 'awaiting_install'); return; }
            await activity('termux', 'installing_python');
            const installed = await runSetupJob('python', () => undefined);
            if (!installed.ok) { failStep(installed.errorKey, installed.detail); return; }
          }
          if (profile === 'termux-local') {
            const setup = await bootstrapWorkstation(getValues('termuxHelperToken'), phase => activity('termux', phase));
            if (!setup.ok) { failStep(setup.errorKey, setup.detail); return; }
          }
          await completeStep('termux', detected.pythonReady ? 'Python was already available. Oni’s helper is connected.' : 'Installed Python and connected Oni’s helper.');
          break;
        }
        case 'kali_health': {
          const savedJob = await activeSetupJob('nethunter');
          if (savedJob) { const resumed = await runSetupJob('nethunter', () => undefined); if (!resumed.ok) { failStep(resumed.errorKey, resumed.detail); return; } }
          await activity('kali_health', 'checking_kali');
          const detected = await inspectSetup('nethunter');
          setInspection(detected);
          if (!detected.ok) { failStep(detected.errorKey); return; }
          if (!detected.kaliReady || !detected.toolsReady) {
            if (!inspection || (inspection.kaliReady && inspection.toolsReady)) { await activity('kali_health', 'awaiting_install'); return; }
            await activity('kali_health', 'installing_kali');
            const installed = await runSetupJob('nethunter', () => undefined);
            if (!installed.ok) { failStep(installed.errorKey, installed.detail); return; }
          }
          await activity('kali_health', 'checking_tools');
          const jobId = newEntityId('onboard-kali');
          const result = await runOnboardingHealthJob(jobId, SYSTEM_PROJECT_ID);
          if (!result.ok) { failStep(result.errorKey, result.detail); return; }
          await completeStep('kali_health', savedJob || !detected.toolsReady ? 'Kali installation finished. Its tools passed the environment check.' : 'Kali, Nmap and Metasploit were already available. The environment check passed.');
          break;
        }
        default:
          router.replace('/');
      }
    } catch {
      failStep('SETUP_INTERRUPTED', 'Setup could not finish. Your progress is saved; check the current job before retrying.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
        <PageHeader title="Setup" setup />

        {currentTask ? <SetupTaskFocus task={currentTask} /> : <>
          <Text accessibilityRole="header" style={styles.title}>{setupStepPresentation(visibleStep).title}</Text>
          <Text style={styles.body}>{setupStepPresentation(visibleStep).explanation}</Text>
        </>}

        {!busy && currentTask?.state !== 'running' && (visibleStep !== 'termux' || stepErrorKey) ? <OnboardingFields form={form} activeStep={visibleStep} profile={profile} repairNeeded={stepErrorKey === 'PERMISSION_DENIED'} openPermissions={() => { void openTermuxAppSettings(); }} /> : null}
        {inspection?.ok && visibleStep === 'termux' && !inspection.pythonReady ? <Text style={styles.body}>Python runs Oni’s setup programs. You don’t need to write code. Installation needs internet and may download package dependencies.</Text> : null}
        {inspection?.ok && visibleStep === 'kali_health' && (!inspection.kaliReady || !inspection.toolsReady) ? <Text style={styles.body}>{inspection.kaliReady ? 'Kali is already available. Oni will install only missing required tools.' : 'The Kali image downloads about 131 MiB. Additional security tools need more downloads. Allow at least 8 GiB free for installation and working space.'}</Text> : null}
        {setupJob ? <SetupJobProgress key={setupJob.id} job={setupJob} /> : null}

        {stepDetail && !stepErrorKey ? <Text style={styles.detail}>{stepDetail}</Text> : null}
        {stepErrorKey ? <Text style={styles.fieldError}>{remediationForErrorKey(stepErrorKey, stepDetail ?? undefined)}</Text> : null}
        {stepErrorKey === 'DATABASE_CREDENTIALS_INVALID' ? <ActionButton label="Recover saved database access" onPress={() => router.push('/settings')} /> : null}

        <ActionButton
          disabled={!progress || busy}
          label={busy ? 'Oni is working…' : activeJob ? 'Check saved installation' : inspection?.ok && ((visibleStep === 'termux' && !inspection.pythonReady) || (visibleStep === 'kali_health' && (!inspection.kaliReady || !inspection.toolsReady))) ? 'Install missing tools' : setupStepPresentation(visibleStep).action}
          onPress={() => void runStep()}
        />

        {visibleStep !== 'complete' ? <SetupHelp title="Why is this needed?">{visibleStep === 'termux' ? 'Android keeps apps separate. Your permission lets Oni ask Termux to run programs. This does not grant Android root access.' : visibleStep === 'kali_health' ? 'Kali supplies tools such as Nmap and Metasploit. Rootless setup works without Android root access, although tools needing deeper access to the phone remain limited.' : 'The database stores Metasploit findings on this phone. Checking the connection confirms the tools can use that storage; it is separate from checking whether a service has started.'}</SetupHelp> : null}

        <SetupTimeline tasks={tasks} />
        <ReadinessPanel />

        {visibleStep === 'complete' ? <>
          <ActionButton variant="outline" label="Explore a sample finding" onPress={() => setShowSample(!showSample)} />
          {showSample ? <Text style={styles.body}>Sample only — no scan was run. A tool might find a web service on a device at port 8080. A service is a program accepting connections; the port helps reach it. This observation alone does not prove a security weakness. Only check devices you own or have permission to test.</Text> : null}
        </> : null}
        {completedSet.has('complete') && visibleStep !== 'complete' ? (
          <ActionButton label="Back to Home" onPress={() => router.replace('/')} />
        ) : null}
      </Screen>
  );
}

const createStyles = (theme: WorkstationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: theme.type.title, fontWeight: '700' },
  intro: { color: theme.colors.muted, fontSize: theme.type.body, lineHeight: 24 },
  stepLabel: { color: theme.colors.accent, fontSize: theme.type.label, textTransform: 'uppercase' },
  body: { color: theme.colors.text, fontSize: theme.type.body, lineHeight: 24 },
  fieldBlock: { gap: theme.spacing.sm },
  fieldLabel: { color: theme.colors.text, fontSize: theme.type.body, fontWeight: '600' },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.control,
    color: theme.colors.surfaceText,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { color: theme.colors.muted, fontSize: theme.type.label, lineHeight: 18 },
  detail: { color: theme.colors.text, fontSize: theme.type.body, lineHeight: 22 },
  fieldError: { color: theme.colors.error, fontSize: theme.type.body, lineHeight: 22 },
});
