import { XMLParser, XMLValidator } from 'fast-xml-parser';

import type { Observation } from '@/core/models/observation.model';

export const NMAP_XML_MAX_BYTES = 5 * 1024 * 1024;

export type NmapParseStatus = 'ok' | 'empty' | 'truncated' | 'parser_failed';

export interface NmapParseOutcomeBase {
  status: NmapParseStatus;
  detail?: string;
}

export interface NmapParseOk extends NmapParseOutcomeBase {
  status: 'ok' | 'empty';
  observations: Observation[];
  documentHash?: string;
}

export interface NmapParseTruncated extends NmapParseOutcomeBase {
  status: 'truncated';
  observations: [];
}

export interface NmapParseFailed extends NmapParseOutcomeBase {
  status: 'parser_failed';
  observations: [];
}

export type NmapParseOutcome = NmapParseOk | NmapParseTruncated | NmapParseFailed;

function createParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    allowBooleanAttributes: true,
    processEntities: false,
    htmlEntities: false,
    trimValues: true,
    stopNodes: ['*.script'],
  });
}

function looksLikeNmapRun(xml: string): boolean {
  return xml.includes('<nmaprun') || xml.includes('<NmapRun');
}

function isTruncatedXml(xml: string): boolean {
  const trimmed = xml.trim();
  if (!trimmed) {
    return false;
  }
  if (!looksLikeNmapRun(trimmed)) {
    return false;
  }
  return !trimmed.endsWith('</nmaprun>') && !trimmed.endsWith('</NmapRun>');
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function hostAddress(host: Record<string, unknown>): string | undefined {
  const addressNode = host.address;
  const addresses = asArray(addressNode as Record<string, unknown> | Record<string, unknown>[]);
  for (const entry of addresses) {
    if (entry && typeof entry === 'object' && entry.addrtype === 'ipv4' && typeof entry.addr === 'string') {
      return entry.addr;
    }
  }
  const first = addresses[0];
  if (first && typeof first.addr === 'string') {
    return first.addr;
  }
  return undefined;
}

function stableTargetKey(address: string): string {
  return address.trim().toLowerCase();
}

export function parseNmapXml(
  xml: string,
  context: { jobId: string; targetHint?: string },
): NmapParseOutcome {
  if (xml.length > NMAP_XML_MAX_BYTES || new TextEncoder().encode(xml).length > NMAP_XML_MAX_BYTES) {
    return {
      status: 'parser_failed',
      observations: [],
      detail: 'XML exceeds maximum allowed size.',
    };
  }

  const trimmed = xml.trim();
  if (!trimmed) {
    return { status: 'empty', observations: [] };
  }

  if (isTruncatedXml(trimmed)) {
    return {
      status: 'truncated',
      observations: [],
      detail: 'Nmap XML document appears truncated.',
    };
  }

  if (!looksLikeNmapRun(trimmed)) {
    return {
      status: 'parser_failed',
      observations: [],
      detail: 'Payload is not a recognizable Nmap XML document.',
    };
  }

  // Nmap emits the inert <!DOCTYPE nmaprun> declaration by default. Accept
  // that exact declaration only; external identifiers and entities stay rejected.
  const safeXml = trimmed.replace(/<!DOCTYPE nmaprun>/g, '');
  if (/<!ENTITY|<!DOCTYPE/i.test(safeXml)) {
    return {
      status: 'parser_failed',
      observations: [],
      detail: 'DTD or entity declarations are not allowed.',
    };
  }

  let parsed: Record<string, unknown>;
  try {
    if (XMLValidator.validate(safeXml) !== true) throw new Error("Malformed XML");
    parsed = createParser().parse(safeXml) as Record<string, unknown>;
  } catch (error) {
    return {
      status: 'parser_failed',
      observations: [],
      detail: error instanceof Error ? error.message : 'XML parse failed.',
    };
  }

  const runNode = (parsed.nmaprun ?? parsed.NmapRun) as Record<string, unknown> | undefined;
  if (!runNode) {
    return {
      status: 'parser_failed',
      observations: [],
      detail: 'Missing nmaprun root element.',
    };
  }

  const scanFlags = typeof runNode.args === 'string' ? runNode.args : undefined;
  const hosts = asArray(runNode.host as Record<string, unknown> | Record<string, unknown>[]);
  const observations: Observation[] = [];
  const observedAt = new Date().toISOString();

  for (const host of hosts) {
    if (!host || typeof host !== 'object') {
      continue;
    }
    const address = hostAddress(host) ?? context.targetHint;
    if (!address) {
      continue;
    }
    const targetKey = stableTargetKey(address);
    const statusNode = host.status as Record<string, unknown> | undefined;
    const hostStatus = typeof statusNode?.state === 'string' ? statusNode.state : undefined;
    const hostReason = typeof statusNode?.reason === 'string' ? statusNode.reason : undefined;

    observations.push({
      type: 'network.host',
      source: 'nmap',
      data: {
        address,
        targetKey,
        status: hostStatus,
        reason: hostReason,
        scanAssumption: 'targets_supplied_with_Pn',
        scanFlags,
        jobId: context.jobId,
      },
      observedAt,
    });

    const portsNode = host.ports as Record<string, unknown> | undefined;
    const portEntries = asArray(portsNode?.port as Record<string, unknown> | Record<string, unknown>[]);
    for (const portEntry of portEntries) {
      if (!portEntry || typeof portEntry !== 'object') {
        continue;
      }
      const portId = typeof portEntry.portid === 'string' ? Number(portEntry.portid) : Number(portEntry.portid);
      if (!Number.isInteger(portId) || portId < 1 || portId > 65535) {
        continue;
      }
      const protocol = typeof portEntry.protocol === 'string' ? portEntry.protocol : 'tcp';
      const stateNode = portEntry.state as Record<string, unknown> | undefined;
      const serviceNode = portEntry.service as Record<string, unknown> | undefined;
      observations.push({
        type: 'network.service',
        source: 'nmap',
        data: {
          address,
          targetKey,
          port: portId,
          protocol,
          state: typeof stateNode?.state === 'string' ? stateNode.state : undefined,
          reason: typeof stateNode?.reason === 'string' ? stateNode.reason : undefined,
          product: typeof serviceNode?.product === 'string' ? serviceNode.product : undefined,
          version: typeof serviceNode?.version === 'string' ? serviceNode.version : undefined,
          scanFlags,
        },
        observedAt,
      });
    }
  }

  if (observations.length === 0) {
    return { status: 'empty', observations: [] };
  }

  return { status: 'ok', observations };
}
