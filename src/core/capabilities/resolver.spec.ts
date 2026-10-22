import { CapabilityRegistry } from '@/core/capabilities/registry';
import { CapabilityResolver } from '@/core/capabilities/resolver';
import { UNIMPLEMENTED_PROVIDERS } from '@/core/capabilities/unimplementedProviders';
import { createTestCapabilityProvider } from '@/testing/nativeDoubles/capabilityProvider.double';

describe('capability resolver', () => {
  it('preserves the actual failure when a registered provider is unavailable', async () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry([
      createTestCapabilityProvider({
        id: 'provider.kali.nmap',
        capabilityIds: ['network.service_detection'],
        errorKey: 'TERMUX_PERMISSION_DENIED',
      }),
    ]));
    const result = await resolver.resolve({ capabilityId: 'network.service_detection' });
    expect(result).toMatchObject({
      resolved: false,
      providerId: 'provider.kali.nmap',
      errorKey: 'TERMUX_PERMISSION_DENIED',
      availability: { available: false, reasons: [{ key: 'TERMUX_PERMISSION_DENIED' }] },
    });
  });

  it('reports missing provider only when none advertise the capability', async () => {
    const resolver = new CapabilityResolver(new CapabilityRegistry([]));
    expect(await resolver.resolve({ capabilityId: 'network.service_detection' }))
      .toMatchObject({ resolved: false, errorKey: 'PROVIDER_NOT_FOUND' });
  });

  it('never marks scaffold Termux/Kali/Postgres/Metasploit/Nmap providers as healthy', async () => {
    const registry = new CapabilityRegistry(UNIMPLEMENTED_PROVIDERS);
    const resolver = new CapabilityResolver(registry);

    const capabilityIds = [
      'network.service_detection',
      'metasploit.database',
      'metasploit.console',
      'workstation.health',
    ] as const;

    for (const capabilityId of capabilityIds) {
      const result = await resolver.resolve({ capabilityId });
      expect(result.resolved).toBe(false);
      expect(result.availability?.available).not.toBe(true);
    }

    const all = await registry.listAllCapabilities();
    expect(all.every((item) => item.available === false)).toBe(true);
    expect(all.every((item) => item.reasons.length > 0)).toBe(true);
  });

  it('re-checks project ownership at execution time', async () => {
    const registry = new CapabilityRegistry([
      createTestCapabilityProvider({
        id: 'provider.kali.nmap',
        capabilityIds: ['network.service_detection'],
        healthy: true,
      }),
    ]);
    const resolver = new CapabilityResolver(registry, {
      ownsProject: (projectId) => projectId === 'owned-project',
    });

    const precheck = await resolver.precheckExecution({
      capabilityId: 'network.service_detection',
      providerId: 'provider.kali.nmap',
      projectId: 'foreign-project',
    });

    expect(precheck.allowed).toBe(false);
    expect(precheck.errorKey).toBe('PROJECT_OWNERSHIP_DENIED');
  });

  it('allows execution when ownership and provider health pass precheck', async () => {
    const registry = new CapabilityRegistry([
      createTestCapabilityProvider({
        id: 'provider.kali.nmap',
        capabilityIds: ['network.service_detection'],
        healthy: true,
      }),
    ]);
    const resolver = new CapabilityResolver(registry, {
      ownsProject: () => true,
    });

    const precheck = await resolver.precheckExecution({
      capabilityId: 'network.service_detection',
      providerId: 'provider.kali.nmap',
      projectId: 'owned-project',
    });

    expect(precheck.allowed).toBe(true);
  });
});
