import type { CapabilityId } from '@/core/capabilities/capabilityIds';
import type { ProviderId } from '@/core/capabilities/providerIds';
import {
  type CapabilityProvider,
  unavailableCapability,
} from '@/core/capabilities/provider.types';
import type { CapabilityAvailability } from '@/core/models/capability.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

interface UnimplementedProviderDefinition {
  id: ProviderId;
  name: string;
  capabilityIds: CapabilityId[];
  errorKey: SkidErrorKey;
  detail: string;
}

const UNIMPLEMENTED_PROVIDER_DEFINITIONS: UnimplementedProviderDefinition[] = [
  {
    id: 'provider.kali.metasploit',
    name: 'Kali Metasploit',
    capabilityIds: ['metasploit.database', 'metasploit.console'],
    errorKey: 'METASPLOIT_UNAVAILABLE',
    detail: 'Metasploit integration is not implemented.',
  },
  {
    id: 'provider.termux.postgresql',
    name: 'Termux PostgreSQL',
    capabilityIds: ['metasploit.database'],
    errorKey: 'CAPABILITY_NOT_IMPLEMENTED',
    detail: 'Termux PostgreSQL provider is deferred.',
  },
];

function createUnimplementedProvider(definition: UnimplementedProviderDefinition): CapabilityProvider {
  return {
    id: definition.id,
    name: definition.name,
    async detect() {
      return {
        providerId: definition.id,
        detected: false,
        errorKey: definition.errorKey,
        detail: definition.detail,
      };
    },
    supportsCapability(capabilityId: CapabilityId) {
      return definition.capabilityIds.includes(capabilityId);
    },
    async listCapabilities(): Promise<CapabilityAvailability[]> {
      return definition.capabilityIds.map((capabilityId) =>
        unavailableCapability(capabilityId, definition.id, [
          { key: definition.errorKey, detail: definition.detail },
        ]),
      );
    },
  };
}

export const UNIMPLEMENTED_PROVIDERS: CapabilityProvider[] = UNIMPLEMENTED_PROVIDER_DEFINITIONS.map(
  createUnimplementedProvider,
);
