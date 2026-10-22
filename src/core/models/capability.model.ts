import type { CapabilityId } from '@/core/capabilities/capabilityIds';
import type { ProviderId } from '@/core/capabilities/providerIds';
import type { SkidErrorKey } from '@/core/security/errorKeys';

/** Advertised capability from a provider after detection. */
export interface Capability {
  id: CapabilityId;
  providerId: ProviderId;
  available: boolean;
  version?: string;
  metadata?: Record<string, unknown>;
}

/** Why a capability is unavailable; never treat missing implementation as healthy. */
export interface CapabilityUnavailableReason {
  key: SkidErrorKey;
  detail?: string;
}

export interface CapabilityAvailability extends Capability {
  reasons: CapabilityUnavailableReason[];
}

export interface CapabilityResolveRequest {
  capabilityId: CapabilityId;
  projectId?: string;
  preferredProviderId?: ProviderId;
}

export interface CapabilityResolveResult {
  capabilityId: CapabilityId;
  resolved: boolean;
  providerId?: ProviderId;
  availability?: CapabilityAvailability;
  errorKey?: SkidErrorKey;
}

export interface ExecutionPrecheckRequest {
  capabilityId: CapabilityId;
  providerId: ProviderId;
  projectId: string;
}

export interface ExecutionPrecheckResult {
  allowed: boolean;
  errorKey?: SkidErrorKey;
  reasons: CapabilityUnavailableReason[];
}
