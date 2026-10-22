import type { SkidErrorKey } from '@/core/security/errorKeys';
import { runStructuredJob } from '@/core/integrations/termux/termuxBridgeClient';
import { newEntityId } from '@/core/storage/ids';

export interface NmapProbeResult {
  ok: boolean;
  versionLine?: string;
  errorKey?: SkidErrorKey;
  detail?: string;
}

/** Lightweight nh nmap --version probe for provider detection. */
export async function probeNmapBinary(timeoutMs = 30_000): Promise<NmapProbeResult> {
  const result = await runStructuredJob({
    jobId: newEntityId('nmap-probe'),
    projectId: 'system',
    timeoutMs,
    command: {
      binary: 'nmap',
      args: ['--version'],
    },
  });

  if (result.errorKey) {
    return { ok: false, errorKey: result.errorKey, detail: result.detail };
  }
  if (!result.ok || result.exitCode !== 0) {
    return {
      ok: false,
      errorKey: 'TOOL_NOT_FOUND',
      detail: result.detail ?? 'nmap --version failed.',
    };
  }

  return { ok: true, versionLine: result.detail ?? 'nmap detected' };
}
