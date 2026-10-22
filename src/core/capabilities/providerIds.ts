export const PROVIDER_IDS = [
  'provider.kali.nmap',
  'provider.kali.metasploit',
  'provider.kali.health',
  'provider.termux.postgresql',
  'provider.termux.shell',
  'provider.termux.setup',
  'provider.termux.terminal',
  'provider.android.usb',
  'provider.android.ble',
  'provider.marauder',
  'provider.flipper',
  'provider.usbcan',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && (PROVIDER_IDS as readonly string[]).includes(value);
}
