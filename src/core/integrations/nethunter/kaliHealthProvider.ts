import {
  availableCapability,
  type CapabilityProvider,
  unavailableCapability,
} from '@/core/capabilities/provider.types';
import { getTermuxStatus, runKaliHealth } from '@/core/integrations/termux/termuxBridgeClient';
import { summarizeNetHunterHealth } from '@/core/integrations/nethunter/nethunterDetector';

export const kaliHealthProvider: CapabilityProvider = {
  id: 'provider.kali.health',
  name: 'Kali workstation health',
  async detect() {
    const termux = await getTermuxStatus();
    if (!termux.installed) {
      return {
        providerId: 'provider.kali.health',
        detected: false,
        errorKey: 'TERMUX_NOT_INSTALLED',
        detail: termux.detail ?? 'Termux is required for NetHunter health probes.',
      };
    }
    if (!termux.permissionGranted) {
      return {
        providerId: 'provider.kali.health',
        detected: false,
        errorKey: 'TERMUX_PERMISSION_DENIED',
        detail: termux.detail ?? 'Grant RUN_COMMAND to Oni in Termux.',
      };
    }

    const health = await runKaliHealth();
    const summary = summarizeNetHunterHealth(health);
    if (!summary.detected) {
      return {
        providerId: 'provider.kali.health',
        detected: false,
        errorKey: summary.errorKey ?? 'NETHUNTER_NOT_FOUND',
        detail: summary.detail ?? 'NetHunter health probe failed.',
      };
    }

    return {
      providerId: 'provider.kali.health',
      detected: true,
      detail: summary.kaliRelease ?? summary.arch,
    };
  },
  supportsCapability(capabilityId) {
    return capabilityId === 'workstation.health';
  },
  async listCapabilities() {
    const detection = await this.detect();
    if (!detection.detected) {
      return [
        unavailableCapability('workstation.health', 'provider.kali.health', [
          {
            key: detection.errorKey ?? 'NETHUNTER_NOT_FOUND',
            detail: detection.detail,
          },
        ]),
      ];
    }
    return [
      availableCapability('workstation.health', 'provider.kali.health', {
        arch: detection.detail,
      }),
    ];
  },
};
