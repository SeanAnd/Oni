/** Bounded explicit port lists for rootless Nmap (-p) arguments. */

export const NMAP_MAX_PORTS = 32;
export const NMAP_MIN_PORT = 1;
export const NMAP_MAX_PORT = 65535;

export type NmapPortsErrorKey =
  | 'NMAP_PORTS_REQUIRED'
  | 'NMAP_PORTS_INVALID'
  | 'NMAP_PORTS_TOO_MANY';

export interface NmapPortsValidationResult {
  ok: boolean;
  normalized?: string;
  portList?: number[];
  errorKey?: NmapPortsErrorKey;
}

function parsePortToken(token: string): number[] | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const rangeMatch = /^(\d{1,5})-(\d{1,5})$/.exec(trimmed);
  if (rangeMatch) {
    const start = Number.parseInt(rangeMatch[1]!, 10);
    const end = Number.parseInt(rangeMatch[2]!, 10);
    if (start > end || start < NMAP_MIN_PORT || end > NMAP_MAX_PORT) {
      return null;
    }
    if (end - start + 1 > NMAP_MAX_PORTS) {
      return null;
    }
    const ports: number[] = [];
    for (let port = start; port <= end; port += 1) {
      ports.push(port);
    }
    return ports;
  }
  if (!/^\d{1,5}$/.test(trimmed)) {
    return null;
  }
  const port = Number.parseInt(trimmed, 10);
  if (port < NMAP_MIN_PORT || port > NMAP_MAX_PORT) {
    return null;
  }
  return [port];
}

export function validateNmapPorts(value: string): NmapPortsValidationResult {
  const normalizedInput = value.trim();
  if (!normalizedInput) {
    return { ok: false, errorKey: 'NMAP_PORTS_REQUIRED' };
  }
  const tokens = normalizedInput.split(',').map((part) => part.trim());
  if (tokens.length === 0) {
    return { ok: false, errorKey: 'NMAP_PORTS_REQUIRED' };
  }

  const unique = new Set<number>();
  for (const token of tokens) {
    const parsed = parsePortToken(token);
    if (!parsed) {
      return { ok: false, errorKey: 'NMAP_PORTS_INVALID' };
    }
    for (const port of parsed) {
      unique.add(port);
    }
    if (unique.size > NMAP_MAX_PORTS) {
      return { ok: false, errorKey: 'NMAP_PORTS_TOO_MANY' };
    }
  }

  const portList = [...unique].sort((a, b) => a - b);
  return {
    ok: true,
    normalized: portList.join(','),
    portList,
  };
}
