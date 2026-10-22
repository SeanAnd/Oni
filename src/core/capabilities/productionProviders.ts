import { terminalProvider } from '@/core/integrations/terminal/terminalProvider';
import { termuxPostgresqlProvider } from '@/core/integrations/postgresql/termuxPostgresqlProvider';
import type { CapabilityProvider } from '@/core/capabilities/provider.types';
import { metasploitProvider } from '@/core/integrations/metasploit/metasploitProvider';
import { nmapProvider } from '@/core/integrations/nmap/nmapProvider';
import { kaliHealthProvider } from '@/core/integrations/nethunter/kaliHealthProvider';
import { termuxShellProvider } from '@/core/integrations/termux/termuxShellProvider';
import { UNIMPLEMENTED_PROVIDERS } from '@/core/capabilities/unimplementedProviders';

const REPLACED_PROVIDER_IDS = new Set<CapabilityProvider['id']>([
  'provider.kali.health',
  'provider.kali.nmap',
  'provider.kali.metasploit',
  'provider.termux.shell',
  'provider.termux.postgresql',
]);

/** Production registry merges real Termux/NetHunter providers with remaining scaffold stubs. */
export const PRODUCTION_PROVIDERS: CapabilityProvider[] = [
  ...UNIMPLEMENTED_PROVIDERS.filter((provider) => !REPLACED_PROVIDER_IDS.has(provider.id)),
  kaliHealthProvider,
  nmapProvider,
  termuxShellProvider,
  terminalProvider,
  termuxPostgresqlProvider,
  metasploitProvider,
];
