import type { CapabilityRegistry } from '@/core/capabilities/registry';
import { defaultCapabilityRegistry } from '@/core/capabilities/registry';
import type {
  CapabilityAvailability,
  CapabilityResolveRequest,
  CapabilityResolveResult,
  ExecutionPrecheckRequest,
  ExecutionPrecheckResult,
} from '@/core/models/capability.model';

export interface ProjectOwnershipGate {
  ownsProject(projectId: string): Promise<boolean> | boolean;
}

const noopOwnershipGate: ProjectOwnershipGate = {
  ownsProject: () => false,
};

function pickProvider(
  candidates: CapabilityAvailability[],
  preferredProviderId?: CapabilityResolveRequest['preferredProviderId'],
): CapabilityAvailability | undefined {
  if (preferredProviderId) {
    const preferred = candidates.find((item) => item.providerId === preferredProviderId);
    if (preferred) {
      return preferred;
    }
  }
  return candidates.find((item) => item.available) ?? candidates[0];
}

export class CapabilityResolver {
  constructor(
    private readonly registry: CapabilityRegistry = defaultCapabilityRegistry,
    private readonly ownershipGate: ProjectOwnershipGate = noopOwnershipGate,
  ) {}

  async resolve(request: CapabilityResolveRequest): Promise<CapabilityResolveResult> {
    const providers = this.registry.providersForCapability(request.capabilityId);
    if (providers.length === 0) {
      return {
        capabilityId: request.capabilityId,
        resolved: false,
        errorKey: 'PROVIDER_NOT_FOUND',
      };
    }

    const advertisements: CapabilityAvailability[] = [];
    for (const provider of providers) {
      const listed = await provider.listCapabilities();
      advertisements.push(...listed.filter((item) => item.id === request.capabilityId));
    }

    if (advertisements.length === 0) {
      return {
        capabilityId: request.capabilityId,
        resolved: false,
        errorKey: 'CAPABILITY_UNAVAILABLE',
      };
    }

    const chosen = pickProvider(advertisements, request.preferredProviderId);
    if (!chosen) {
      return {
        capabilityId: request.capabilityId,
        resolved: false,
        errorKey: 'PROVIDER_NOT_FOUND',
      };
    }

    if (!chosen.available) {
      return {
        capabilityId: request.capabilityId,
        resolved: false,
        providerId: chosen.providerId,
        availability: chosen,
        errorKey: chosen.reasons[0]?.key ?? 'CAPABILITY_UNAVAILABLE',
      };
    }

    return {
      capabilityId: request.capabilityId,
      resolved: true,
      providerId: chosen.providerId,
      availability: chosen,
    };
  }

  /** Re-check availability and project ownership immediately before execution. */
  async precheckExecution(request: ExecutionPrecheckRequest): Promise<ExecutionPrecheckResult> {
    if (!request.projectId.trim()) {
      return {
        allowed: false,
        errorKey: 'PROJECT_NOT_FOUND',
        reasons: [{ key: 'PROJECT_NOT_FOUND', detail: 'projectId is required' }],
      };
    }

    const ownsProject = await this.ownershipGate.ownsProject(request.projectId);
    if (!ownsProject) {
      return {
        allowed: false,
        errorKey: 'PROJECT_OWNERSHIP_DENIED',
        reasons: [{ key: 'PROJECT_OWNERSHIP_DENIED' }],
      };
    }

    const resolution = await this.resolve({
      capabilityId: request.capabilityId,
      projectId: request.projectId,
      preferredProviderId: request.providerId,
    });

    if (!resolution.resolved || !resolution.availability?.available) {
      const reasons = resolution.availability?.reasons ?? [
        { key: resolution.errorKey ?? 'CAPABILITY_UNAVAILABLE' },
      ];
      return {
        allowed: false,
        errorKey: resolution.errorKey ?? reasons[0]?.key ?? 'CAPABILITY_UNAVAILABLE',
        reasons,
      };
    }

    if (resolution.providerId !== request.providerId) {
      return {
        allowed: false,
        errorKey: 'PROVIDER_NOT_FOUND',
        reasons: [{ key: 'PROVIDER_NOT_FOUND', detail: 'Requested provider is not available.' }],
      };
    }

    return { allowed: true, reasons: [] };
  }
}

export const defaultCapabilityResolver = new CapabilityResolver();
