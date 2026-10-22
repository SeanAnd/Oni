import type { CapabilityId } from '@/core/capabilities/capabilityIds';
import type { ProviderId } from '@/core/capabilities/providerIds';
import {
  availableCapability,
  type CapabilityProvider,
  unavailableCapability,
} from '@/core/capabilities/provider.types';

/**
 * Test-only provider double. Never registered in production `defaultCapabilityRegistry`.
 */
export function createTestCapabilityProvider(options: {
  id: ProviderId;
  name?: string;
  capabilityIds: CapabilityId[];
  healthy?: boolean;
  errorKey?: Parameters<typeof unavailableCapability>[2][0]['key'];
}): CapabilityProvider {
  const healthy = options.healthy ?? false;
  return {
    id: options.id,
    name: options.name ?? `test-${options.id}`,
    async detect() {
      return {
        providerId: options.id,
        detected: healthy,
        errorKey: healthy ? undefined : options.errorKey ?? 'CAPABILITY_NOT_IMPLEMENTED',
      };
    },
    supportsCapability(capabilityId: CapabilityId) {
      return options.capabilityIds.includes(capabilityId);
    },
    async listCapabilities() {
      return options.capabilityIds.map((capabilityId) =>
        healthy
          ? availableCapability(capabilityId, options.id, { testDouble: true })
          : unavailableCapability(capabilityId, options.id, [
              { key: options.errorKey ?? 'CAPABILITY_NOT_IMPLEMENTED' },
            ]),
      );
    },
  };
}
