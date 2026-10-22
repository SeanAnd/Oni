import { unavailableCapability, type CapabilityProvider } from '@/core/capabilities/provider.types';
import { invokeDatabaseLifecycle } from './databaseLifecycleService';
import { readEnvironmentProfile } from '@/core/state/environmentProfile';

export const termuxPostgresqlProvider: CapabilityProvider = {
  id: 'provider.termux.postgresql', name: 'Device PostgreSQL',
  supportsCapability: id => id === 'metasploit.database',
  async detect() {
    if (await readEnvironmentProfile() !== 'termux-local') return {providerId: this.id, detected: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: 'Device database profile is not selected.'};
    const inventory = await invokeDatabaseLifecycle('detect');
    if (!inventory.ok || inventory.operation !== 'detect') return {providerId: this.id, detected: false, errorKey: inventory.errorKey, detail: inventory.detail ?? 'Device database inventory is unavailable.'};
    if (!inventory.packageInstalled) return {providerId: this.id, detected: false, errorKey: 'TOOL_NOT_FOUND', detail: 'PostgreSQL is not installed on this device. Continue setup to install it.'};
    if (!inventory.clusterInitialized) return {providerId: this.id, detected: false, errorKey: 'DATABASE_UNAVAILABLE', detail: 'PostgreSQL is installed; the private database needs initialization in setup.'};
    if (!inventory.serverReachable) return {providerId: this.id, detected: false, errorKey: 'DATABASE_UNAVAILABLE', detail: 'The private database is initialized and stopped. Start DB to reconnect.'};
    const result = await invokeDatabaseLifecycle('health');
    const detected = result.ok && result.operation === 'health' && result.authenticatedQueryOk;
    return {providerId: this.id, detected, errorKey: detected ? undefined : result.errorKey ?? 'DATABASE_UNAVAILABLE', detail: result.detail ?? (detected ? `Device PostgreSQL authenticated${result.operation === 'health' && result.databaseSizeBytes !== undefined ? `; ${(result.databaseSizeBytes / 1024 / 1024).toFixed(1)} MiB` : ''}. Framework verification is separate.` : 'Initialize or start the device database.')};
  },
  async listCapabilities() {
    const status = await this.detect();
    return [unavailableCapability('metasploit.database', this.id, [{key: status.errorKey ?? 'METASPLOIT_UNAVAILABLE', detail: status.detail ?? 'Verify Framework separately.'}])];
  },
};
