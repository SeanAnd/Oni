import type { CapabilityId } from '@/core/capabilities/capabilityIds';
import type { ProviderId } from '@/core/capabilities/providerIds';
import type {
  Capability,
  CapabilityAvailability,
  CapabilityUnavailableReason,
} from '@/core/models/capability.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export interface ProviderDetectionResult {
  providerId: ProviderId;
  detected: boolean;
  errorKey?: SkidErrorKey;
  detail?: string;
}

export interface CapabilityProvider {
  id: ProviderId;
  name: string;
  detect(): Promise<ProviderDetectionResult>;
  listCapabilities(): Promise<CapabilityAvailability[]>;
  supportsCapability(capabilityId: CapabilityId): boolean;
}

export function unavailableCapability(
  capabilityId: CapabilityId,
  providerId: ProviderId,
  reasons: CapabilityUnavailableReason[],
): CapabilityAvailability {
  return {
    id: capabilityId,
    providerId,
    available: false,
    reasons,
  };
}

export function availableCapability(
  capabilityId: CapabilityId,
  providerId: ProviderId,
  metadata?: Record<string, unknown>,
): CapabilityAvailability {
  return {
    id: capabilityId,
    providerId,
    available: true,
    reasons: [],
    metadata,
  };
}

/** Strip availability to the wire contract when a consumer only needs Capability[]. */
export function toCapability(advertisement: CapabilityAvailability): Capability {
  const { reasons: _reasons, ...capability } = advertisement;
  return capability;
}
