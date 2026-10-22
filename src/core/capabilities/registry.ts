import type { CapabilityId } from '@/core/capabilities/capabilityIds';
import type { ProviderId } from '@/core/capabilities/providerIds';
import type { CapabilityProvider } from '@/core/capabilities/provider.types';
import { PRODUCTION_PROVIDERS } from '@/core/capabilities/productionProviders';
import type { CapabilityAvailability } from '@/core/models/capability.model';

export class CapabilityRegistry {
  private readonly providers = new Map<ProviderId, CapabilityProvider>();

  constructor(initialProviders: CapabilityProvider[] = PRODUCTION_PROVIDERS) {
    for (const provider of initialProviders) {
      this.registerProvider(provider);
    }
  }

  registerProvider(provider: CapabilityProvider): void {
    this.providers.set(provider.id, provider);
  }

  getProvider(providerId: ProviderId): CapabilityProvider | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): CapabilityProvider[] {
    return [...this.providers.values()];
  }

  providersForCapability(capabilityId: CapabilityId): CapabilityProvider[] {
    return this.listProviders().filter((provider) => provider.supportsCapability(capabilityId));
  }

  async listAllCapabilities(): Promise<CapabilityAvailability[]> {
    const advertisements: CapabilityAvailability[] = [];
    for (const provider of this.listProviders()) {
      advertisements.push(...(await provider.listCapabilities()));
    }
    return advertisements;
  }
}

/** Default registry: production providers (Termux bridge + remaining scaffold stubs). */
export const defaultCapabilityRegistry = new CapabilityRegistry();
