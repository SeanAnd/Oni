/** Pure validation for rootless Nmap IPv4 / CIDR targets. */

export const NMAP_MAX_TARGET_ADDRESSES = 16;

const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1?\\d{1,2})';
const IPV4_PATTERN = new RegExp(`^${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}\\.${IPV4_OCTET}$`);

export type NmapTargetErrorKey =
  | 'NMAP_TARGET_REQUIRED'
  | 'NMAP_TARGET_INVALID'
  | 'NMAP_TARGET_TOO_LARGE';

export interface NmapTargetValidationResult {
  ok: boolean;
  normalized?: string;
  errorKey?: NmapTargetErrorKey;
}

function parseIpv4(value: string): number[] | null {
  if (!IPV4_PATTERN.test(value)) {
    return null;
  }
  return value.split('.').map((part) => Number.parseInt(part, 10));
}

function hostCountForPrefix(prefix: number): number {
  if (prefix < 0 || prefix > 32) {
    return Number.MAX_SAFE_INTEGER;
  }
  return 2 ** (32 - prefix);
}

export function countAddressesInTarget(target: string): number | null {
  const trimmed = target.trim();
  if (IPV4_PATTERN.test(trimmed)) {
    return 1;
  }
  const cidrMatch = /^(.+)\/(\d{1,2})$/.exec(trimmed);
  if (!cidrMatch) {
    return null;
  }
  const octets = parseIpv4(cidrMatch[1]!);
  const prefix = Number.parseInt(cidrMatch[2]!, 10);
  if (!octets || prefix < 0 || prefix > 32) {
    return null;
  }
  return hostCountForPrefix(prefix);
}

export function validateNmapTarget(value: string): NmapTargetValidationResult {
  const normalized = value.trim();
  if (!normalized) {
    return { ok: false, errorKey: 'NMAP_TARGET_REQUIRED' };
  }
  const count = countAddressesInTarget(normalized);
  if (count === null) {
    return { ok: false, errorKey: 'NMAP_TARGET_INVALID' };
  }
  if (count > NMAP_MAX_TARGET_ADDRESSES) {
    return { ok: false, errorKey: 'NMAP_TARGET_TOO_LARGE' };
  }
  return { ok: true, normalized };
}
