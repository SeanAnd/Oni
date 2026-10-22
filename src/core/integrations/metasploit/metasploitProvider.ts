import {
  availableCapability,
  type CapabilityProvider,
  unavailableCapability,
} from '@/core/capabilities/provider.types';
import { selectedDatabaseProvider } from '@/core/integrations/postgresql/selectedDatabaseProvider';
import { probeMetasploitDatabaseConnection } from '@/core/integrations/metasploit/metasploitClient';
import { getTermuxStatus } from '@/core/integrations/termux/termuxBridgeClient';
import type { SkidErrorKey } from '@/core/security/errorKeys';

async function consoleReasons(databaseReasons: { key: SkidErrorKey; detail: string }[]): Promise<{ key: SkidErrorKey; detail: string }[]> {
  const termux = await getTermuxStatus();
  if (!termux.installed) {
    return [{ key: 'TERMUX_NOT_INSTALLED', detail: termux.detail ?? 'Install Termux before launching Metasploit.' }];
  }
  if (!termux.permissionGranted) {
    return [
      {
        key: 'TERMUX_PERMISSION_DENIED',
        detail: termux.detail ?? 'Grant RUN_COMMAND to Oni in Termux settings.',
      },
    ];
  }
  return databaseReasons;
}

async function metasploitDatabaseReasons(): Promise<{ key: SkidErrorKey; detail: string }[]> {
  const database = await (await selectedDatabaseProvider()).detect();
  if (!database.detected) {
    return [
      {
        key: database.errorKey ?? 'DATABASE_UNAVAILABLE',
        detail: database.detail ?? 'Selected PostgreSQL is not ready for Metasploit.',
      },
    ];
  }

  const verify = await probeMetasploitDatabaseConnection();
  if (!verify.ok) {
    return [
      {
        key: verify.errorKey ?? 'METASPLOIT_UNAVAILABLE',
        detail: verify.detail ?? 'Metasploit database verification failed.',
      },
    ];
  }
  if (!verify.connected) {
    return [
      {
        key: 'METASPLOIT_UNAVAILABLE',
        detail: verify.detail ?? 'Framework is not connected to PostgreSQL.',
      },
    ];
  }
  if (!verify.schemaReady) {
    return [
      {
        key: 'METASPLOIT_UNAVAILABLE',
        detail: 'Framework connection succeeded but schema readiness was not confirmed.',
      },
    ];
  }
  return [];
}

export const metasploitProvider: CapabilityProvider = {
  id: 'provider.kali.metasploit',
  name: 'Kali Metasploit',
  async detect() {
    const reasons = await metasploitDatabaseReasons();
    if (reasons.length > 0) {
      return {
        providerId: 'provider.kali.metasploit',
        detected: false,
        errorKey: reasons[0].key,
        detail: reasons[0].detail,
      };
    }
    return {
      providerId: 'provider.kali.metasploit',
      detected: true,
      detail: 'Framework database connection verified from Kali.',
    };
  },
  supportsCapability(capabilityId) {
    return capabilityId === 'metasploit.database' || capabilityId === 'metasploit.console';
  },
  async listCapabilities() {
    const databaseReasonsList = await metasploitDatabaseReasons();
    const databaseAvailability =
      databaseReasonsList.length > 0
        ? unavailableCapability('metasploit.database', 'provider.kali.metasploit', databaseReasonsList)
        : availableCapability('metasploit.database', 'provider.kali.metasploit');

    // Both advertisements describe one snapshot; do not launch Framework twice.
    const consoleReasonsList = await consoleReasons(databaseReasonsList);
    const consoleAvailability =
      consoleReasonsList.length > 0
        ? unavailableCapability('metasploit.console', 'provider.kali.metasploit', consoleReasonsList)
        : availableCapability('metasploit.console', 'provider.kali.metasploit');

    return [databaseAvailability, consoleAvailability];
  },
};
