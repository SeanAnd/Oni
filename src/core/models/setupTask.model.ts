import type { OnboardingStepId } from './onboardingForm.model';

export const SETUP_TASKS = ['termux', 'kali_health', 'database_initialize', 'database_start', 'metasploit_config', 'metasploit_verify'] as const;
export type SetupTaskId = typeof SETUP_TASKS[number];
export type SetupActivity = 'checking_access' | 'checking_python' | 'installing_python' | 'installing_helper' | 'starting_helper' | 'checking_kali' | 'awaiting_install' | 'installing_kali' | 'checking_tools' | 'detecting_database' | 'installing_database' | 'initializing_database' | 'starting_database' | 'configuring_framework' | 'verifying_framework';
export interface SetupTaskRecord {
  startedAt: number;
  activity: SetupActivity;
  finishedAt?: number;
  outcome?: string;
}
export type SetupTaskRecords = Partial<Record<SetupTaskId, SetupTaskRecord>>;
export function isSetupTask(step: OnboardingStepId): step is SetupTaskId {
  return SETUP_TASKS.some(value => value === step);
}
export type SetupActivityReporter = (step: SetupTaskId, activity: SetupActivity) => Promise<void>;
