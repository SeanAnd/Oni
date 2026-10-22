export const CAPABILITY_IDS = [
  'network.discovery',
  'network.service_detection',
  'wifi.scan',
  'wifi.capture',
  'bluetooth.scan',
  'hid.execute',
  'can.monitor',
  'can.transmit',
  'subghz.scan',
  'nfc.read',
  'rfid.read',
  'metasploit.database',
  'metasploit.console',
  'workstation.health',
  'workstation.setup',
  'terminal.session',
] as const;

export type CapabilityId = (typeof CAPABILITY_IDS)[number];

export function isCapabilityId(value: unknown): value is CapabilityId {
  return typeof value === 'string' && (CAPABILITY_IDS as readonly string[]).includes(value);
}
