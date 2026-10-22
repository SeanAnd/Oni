import {
  availableCapability,
  type CapabilityProvider,
  unavailableCapability,
} from '@/core/capabilities/provider.types';
import { metasploitProvider } from '@/core/integrations/metasploit/metasploitProvider';
import { getTermuxStatus } from '@/core/integrations/termux/termuxBridgeClient';

export const termuxShellProvider: CapabilityProvider = {
  id: 'provider.termux.shell',
  name: 'Termux shell',
  async detect() {
    const status = await getTermuxStatus();
    if (!status.installed) {
      return {
        providerId: 'provider.termux.shell',
        detected: false,
        errorKey: 'TERMUX_NOT_INSTALLED',
        detail: status.detail,
      };
    }
    if (!status.permissionGranted) {
      return {
        providerId: 'provider.termux.shell',
        detected: false,
        errorKey: 'TERMUX_PERMISSION_DENIED',
        detail: status.detail,
      };
    }
    return {
      providerId: 'provider.termux.shell',
      detected: true,
    };
  },
  supportsCapability(capabilityId) {
    return capabilityId === 'metasploit.console' || capabilityId === 'workstation.health';
  },
  async listCapabilities() {
    const detection = await this.detect();
    if (!detection.detected) {
      const reasons = [{ key: detection.errorKey ?? 'TERMUX_NOT_INSTALLED', detail: detection.detail ?? '' }];
      return (['metasploit.console', 'workstation.health'] as const).map((capabilityId) =>
        unavailableCapability(capabilityId, 'provider.termux.shell', reasons),
      );
    }

    const metasploit = await metasploitProvider.listCapabilities();
    const consoleAd = metasploit.find((entry) => entry.id === 'metasploit.console');
    return [
      consoleAd ?? unavailableCapability('metasploit.console', 'provider.termux.shell', [
        { key: 'METASPLOIT_UNAVAILABLE', detail: 'Metasploit console prerequisites are not met.' },
      ]),
      availableCapability('workstation.health', 'provider.termux.shell'),
    ];
  },
};
