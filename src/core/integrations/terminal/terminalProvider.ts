import { Terminal } from '~/modules/terminal/src';
import { getTermuxStatus } from '@/core/integrations/termux/termuxBridgeClient';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { availableCapability, unavailableCapability, type CapabilityProvider } from '@/core/capabilities/provider.types';
export const terminalProvider: CapabilityProvider = {
  id: 'provider.termux.terminal', name: 'On-device terminal',
  supportsCapability: id => id === 'terminal.session',
  async detect() {
    const status = await getTermuxStatus();
    if (!status.installed || !status.permissionGranted) return { providerId: this.id, detected: false, errorKey: status.installed ? 'TERMUX_PERMISSION_DENIED' : 'TERMUX_NOT_INSTALLED' };
    try {
      const ready = await Terminal.detect();
      return { providerId: this.id, detected: ready.ok, errorKey: ready.ok ? undefined : 'CAPABILITY_UNAVAILABLE' };
    } catch { return { providerId: this.id, detected: false, errorKey: 'CAPABILITY_UNAVAILABLE' }; }
  },
  async listCapabilities() {
    const detected = await this.detect();
    const paired = detected.detected && !!await getTermuxHelperToken();
    if (!paired) return [unavailableCapability('terminal.session', this.id, [{ key: detected.errorKey ?? 'PERMISSION_DENIED', detail: 'Install/update the local helper in Settings and grant Run commands in Termux.' }])];
    return [availableCapability('terminal.session', this.id)];
  },
};
