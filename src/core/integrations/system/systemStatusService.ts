import { metasploitProvider } from '@/core/integrations/metasploit/metasploitProvider';
import { kaliHealthProvider } from '@/core/integrations/nethunter/kaliHealthProvider';
import { selectedDatabaseProvider } from '@/core/integrations/postgresql/selectedDatabaseProvider';
import { readEnvironmentProfile, holdProfile } from '@/core/state/environmentProfile';
import { getTermuxStatus } from '@/core/integrations/termux/termuxBridgeClient';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export interface IntegrationStatus {
  label: string;
  ok: boolean;
  detail: string;
  errorKey?: SkidErrorKey;
}

export interface SystemStatusSnapshot {
  termux: IntegrationStatus;
  kali: IntegrationStatus;
  database: IntegrationStatus;
  metasploit: IntegrationStatus;
  profileNote: string;
}

export async function loadSystemStatusSnapshot(): Promise<SystemStatusSnapshot> {
  await readEnvironmentProfile();
  const release = holdProfile();
  try {
  await readEnvironmentProfile();
  const termuxRaw = await getTermuxStatus();
  const termux: IntegrationStatus = {
    label: 'Termux',
    ok: termuxRaw.installed && termuxRaw.permissionGranted,
    detail:
      termuxRaw.detail ??
      (termuxRaw.installed && termuxRaw.permissionGranted
        ? 'RUN_COMMAND permission granted.'
        : 'Termux is not ready.'),
    errorKey: termuxRaw.errorKey,
  };

  const kaliDetection = await kaliHealthProvider.detect();
  const kali: IntegrationStatus = {
    label: 'NetHunter Rootless',
    ok: kaliDetection.detected,
    detail: kaliDetection.detail ?? (kaliDetection.detected ? 'Kali health probe succeeded.' : 'Kali is unavailable.'),
    errorKey: kaliDetection.errorKey,
  };

  const databaseDetection = await (await selectedDatabaseProvider()).detect();
  const database: IntegrationStatus = {
    label: 'On-device PostgreSQL',
    ok: databaseDetection.detected,
    detail:
      databaseDetection.detail ??
      (databaseDetection.detected
        ? 'Device database authenticated.'
        : 'Device database or helper is not ready.'),
    errorKey: databaseDetection.errorKey,
  };

  const metasploitDetection = await metasploitProvider.detect();
  const metasploit: IntegrationStatus = {
    label: 'Metasploit',
    ok: metasploitDetection.detected,
    detail:
      metasploitDetection.detail ??
      (metasploitDetection.detected
        ? 'Framework database connection verified.'
        : 'Metasploit database is not verified.'),
    errorKey: metasploitDetection.errorKey,
  };

  return {
    termux,
    kali,
    database,
    metasploit,
    profileNote:
      'Data lives in Termux on this device. Start services again after Termux is stopped or the device reboots.',
  };
  } finally { release(); }
}
