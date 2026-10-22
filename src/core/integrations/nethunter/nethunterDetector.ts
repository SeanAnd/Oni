import type { KaliHealthResult } from '@/core/integrations/termux/termuxBridgeClient';

export interface NetHunterEnvironmentSummary {
  detected: boolean;
  arch?: string;
  kaliRelease?: string;
  nhPath?: string;
  helperVersion?: string;
  errorKey?: KaliHealthResult['errorKey'];
  detail?: string;
}

export function summarizeNetHunterHealth(health: KaliHealthResult): NetHunterEnvironmentSummary {
  return {
    detected: health.ok,
    arch: health.arch,
    kaliRelease: health.kaliRelease,
    nhPath: health.nhPath,
    helperVersion: health.helperVersion,
    errorKey: health.errorKey,
    detail: health.detail,
  };
}
