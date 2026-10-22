import type { SkidErrorKey } from '@/core/security/errorKeys';

const REMEDIATION: Partial<Record<SkidErrorKey, string>> = {
  CAPABILITY_UNAVAILABLE: 'Use an Android development build with native modules compiled.',
  CAPABILITY_NOT_IMPLEMENTED: 'This capability is not available in the current MVP slice.',
  DATABASE_PROFILE_RETIRED: 'This host operation was retired without retrying it. Start new work using on-device PostgreSQL.',
  DATABASE_UNAVAILABLE: 'Start or initialize the selected PostgreSQL database from Settings or Setup.',
  DATABASE_CREDENTIALS_INVALID: 'Restore the original credential for the selected profile. Credentials are never rotated automatically.',
  DATABASE_TRANSPORT_UNAVAILABLE:
    'Open Termux and recover the device helper from Settings.',
  METASPLOIT_UNAVAILABLE: 'Configure Metasploit database.yml from Setup, then verify the Framework connection.',
  SETUP_REQUIRED: 'Finish Setup before starting this action.',
  SETUP_STATUS_UNAVAILABLE: 'Setup status could not be checked. Retry or open Setup.',
  SETUP_INTERRUPTED: 'Installation needs checking. Open Termux, then continue the saved setup job.',
  SETUP_BUSY: 'Another installation is running. Let it finish, then check again.',
  SETUP_PACKAGE_REPAIR_REQUIRED: 'Installed packages need checking. Existing files have been kept; inspect installation details before retrying.',
  SETUP_DOWNLOAD_FAILED: 'The download could not finish. Check your connection and try again; earlier steps are saved.',
  SETUP_PYTHON_UNAVAILABLE: 'Python did not start successfully. Check the Termux package installation.',
  SETUP_BOOTSTRAP_UNAVAILABLE: 'Open Termux and finish its initial setup, then return to Oni.',
  SETUP_EXISTING_INSTALLATION: 'We found an existing installation that needs inspection. Its files have been kept.',
  SETUP_CATALOG_MISMATCH: 'The download differs from the reviewed image. It was not installed; update Oni or inspect the saved download.',
  STORAGE_FULL: 'Free some space, then retry. Your completed setup steps are saved.',
  NETHUNTER_NOT_FOUND: 'Install NetHunter Rootless and run the Termux bootstrap bundle.',
  PERMISSION_DENIED: 'Recover local helper pairing in Settings using the original device token.',
  TERMUX_NOT_INSTALLED: 'Install Termux, enable allow-external-apps, and run the bootstrap install command.',
  TERMUX_PERMISSION_DENIED: 'Open Oni app permissions from Setup and grant Run commands in Termux.',
  JOB_TIMEOUT: 'Inspect the pending job, open Termux, and recover services before retrying.',
  INVALID_PAYLOAD: 'Fix the highlighted fields and retry.',
};

export function remediationForErrorKey(key: SkidErrorKey | undefined, fallback?: string): string {
  if (!key) {
    return fallback ?? 'Review prerequisites and retry.';
  }
  return fallback ?? REMEDIATION[key] ?? 'Review prerequisites and retry.';
}
