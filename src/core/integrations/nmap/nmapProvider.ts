import {
  availableCapability,
  type CapabilityProvider,
  unavailableCapability,
} from '@/core/capabilities/provider.types';
import {
  getTermuxStatus,
  runKaliHealth,
} from '@/core/integrations/termux/termuxBridgeClient';
import { summarizeNetHunterHealth } from '@/core/integrations/nethunter/nethunterDetector';

import { NMAP_CAPABILITY_ID, NMAP_PROVIDER_ID } from '@/core/integrations/nmap/nmapAdapter';
import { probeNmapBinary } from '@/core/integrations/nmap/nmapProbe';

export const nmapProvider: CapabilityProvider = {
  id: NMAP_PROVIDER_ID,
  name: 'Kali Nmap',
  async detect() {
    const termux = await getTermuxStatus();
    if (!termux.installed) {
      return {
        providerId: NMAP_PROVIDER_ID,
        detected: false,
        errorKey: 'TERMUX_NOT_INSTALLED',
        detail: termux.detail ?? 'Termux is required for Nmap execution.',
      };
    }
    if (!termux.permissionGranted) {
      return {
        providerId: NMAP_PROVIDER_ID,
        detected: false,
        errorKey: 'TERMUX_PERMISSION_DENIED',
        detail: termux.detail ?? 'Grant RUN_COMMAND to Oni in Termux.',
      };
    }

    const health = await runKaliHealth();
    const summary = summarizeNetHunterHealth(health);
    if (!summary.detected) {
      return {
        providerId: NMAP_PROVIDER_ID,
        detected: false,
        errorKey: summary.errorKey ?? 'NETHUNTER_NOT_FOUND',
        detail: summary.detail ?? 'NetHunter environment is unavailable.',
      };
    }

    const nmap = await probeNmapBinary();
    if (!nmap.ok) {
      return {
        providerId: NMAP_PROVIDER_ID,
        detected: false,
        errorKey: nmap.errorKey ?? 'TOOL_NOT_FOUND',
        detail: nmap.detail ?? 'Nmap is not available in the Kali userland.',
      };
    }

    return {
      providerId: NMAP_PROVIDER_ID,
      detected: true,
      detail: nmap.versionLine,
    };
  },
  supportsCapability(capabilityId) {
    return capabilityId === NMAP_CAPABILITY_ID;
  },
  async listCapabilities() {
    const detection = await this.detect();
    if (!detection.detected) {
      return [
        unavailableCapability(NMAP_CAPABILITY_ID, NMAP_PROVIDER_ID, [
          {
            key: detection.errorKey ?? 'TOOL_NOT_FOUND',
            detail: detection.detail ?? 'Nmap is unavailable.',
          },
        ]),
      ];
    }
    return [
      availableCapability(NMAP_CAPABILITY_ID, NMAP_PROVIDER_ID, {
        scanProfile: 'rootless_tcp_connect',
        version: detection.detail,
      }),
    ];
  },
};
