import type { SetupActivityReporter } from '@/core/models/setupTask.model';
import { invokeDatabaseLifecycle } from '@/core/integrations/postgresql/databaseLifecycleService';
import { writeMetasploitDatabaseConfig } from '@/core/integrations/metasploit/metasploitClient';
import { prepareMetasploitSchema } from '@/core/integrations/metasploit/metasploitSetupJob';
import { ensureDeviceDatabasePassword } from '@/core/security/databaseCredentials';
import { newEntityId } from '@/core/storage/ids';
import type { OnboardingStepId } from '@/core/models/onboardingForm.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export const SAVED_RESULTS_STEPS = ['database_initialize', 'database_start', 'metasploit_config', 'metasploit_verify'] as const;
export type SavedResultsStep = typeof SAVED_RESULTS_STEPS[number];
export function isSavedResultsStep(step: OnboardingStepId): step is SavedResultsStep {
  return SAVED_RESULTS_STEPS.some(value => value === step);
}

/** Continue the authorized sequence using the existing durable operations. Each
 * successful boundary is saved; a retry begins at the first unfinished step. */
export async function finishWorkstationSetup(start: SavedResultsStep, onStep: (step: SavedResultsStep) => void, onComplete: (step: SavedResultsStep, outcome?: string) => Promise<void>, onActivity: SetupActivityReporter = async () => undefined): Promise<{ok: boolean; errorKey?: SkidErrorKey; detail?: string}> {
  for (const step of SAVED_RESULTS_STEPS.slice(SAVED_RESULTS_STEPS.indexOf(start))) {
    onStep(step);
    let outcome: string | undefined;
    switch (step) {
      case 'database_initialize': {
        await onActivity(step, 'detecting_database');
        const detected = await invokeDatabaseLifecycle('detect');
        if (!detected.ok) return detected;
        if (detected.operation === 'detect' && !detected.packageInstalled) {
          await onActivity(step, 'installing_database');
          const installed = await invokeDatabaseLifecycle('install');
          if (!installed.ok) return installed;
        }
        await onActivity(step, 'initializing_database');
        const initialized = await invokeDatabaseLifecycle('initialize');
        if (!initialized.ok) return initialized;
        outcome = detected.operation === 'detect' && detected.packageInstalled ? 'PostgreSQL was already installed. Your saved-results storage is prepared.' : 'Installed PostgreSQL and prepared your saved-results storage.';
        break;
      }
      case 'database_start': {
        await onActivity(step, 'starting_database');
        const result = await invokeDatabaseLifecycle('start');
        if (!result.ok) return result;
        break;
      }
      case 'metasploit_config': {
        await onActivity(step, 'configuring_framework');
        const result = await writeMetasploitDatabaseConfig({jobId: newEntityId('msf-config'), password: await ensureDeviceDatabasePassword(), host: '127.0.0.1', profileId: 'termux-local', username: 'msf', database: 'msf'});
        if (!result.ok || !result.configured) return {...result, ok: false};
        break;
      }
      case 'metasploit_verify': {
        await onActivity(step, 'verifying_framework');
        const result = await prepareMetasploitSchema();
        if (!result.ok || !result.connected || !result.schemaReady) return {...result, ok: false};
      }
    }
    await onComplete(step, outcome);
  }
  return {ok: true};
}
