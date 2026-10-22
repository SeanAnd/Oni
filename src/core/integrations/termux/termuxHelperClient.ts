import type { HelperCallResult } from '@/core/integrations/termux/termuxBridgeClient';
import {
  cancelHelperJob,
  getHelperJobStatus,
  readHelperArtifactChunk,
} from '@/core/integrations/termux/termuxBridgeClient';

export const TERMUX_HELPER_DEFAULT_BASE_URL = 'http://127.0.0.1:28765';
export const TERMUX_HELPER_JOBS_STATUS_ROUTE = '/v1/workstation/jobs/status';
export const TERMUX_HELPER_JOBS_CANCEL_ROUTE = '/v1/workstation/jobs/cancel';
export const TERMUX_HELPER_ARTIFACTS_CHUNK_ROUTE = '/v1/workstation/artifacts/chunk';
export const TERMUX_HELPER_MAX_CHUNK_BYTES = 65_536;

export interface TermuxHelperClientOptions {
  getAccessToken: () => Promise<string | null>;
}

/**
 * Thin orchestration wrapper around native helper polling/transfer.
 * Native code performs HTTP on-device; JS callers supply the Termux-stored token.
 */
export class TermuxHelperClient {
  private readonly getAccessToken: () => Promise<string | null>;

  constructor(options: TermuxHelperClientOptions) {
    this.getAccessToken = options.getAccessToken;
  }

  async fetchJobStatus(jobId: string, operationId: string): Promise<HelperCallResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return { ok: false, errorKey: 'PERMISSION_DENIED', detail: 'Termux helper token is unavailable.' };
    }
    return getHelperJobStatus(jobId, operationId, token);
  }

  async cancelJob(jobId: string, operationId: string): Promise<HelperCallResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return { ok: false, errorKey: 'PERMISSION_DENIED', detail: 'Termux helper token is unavailable.' };
    }
    return cancelHelperJob(jobId, operationId, token);
  }

  async readArtifactChunk(
    artifactId: string,
    offset: number,
    limit: number,
    operationId: string,
  ): Promise<HelperCallResult> {
    const token = await this.getAccessToken();
    if (!token) {
      return { ok: false, errorKey: 'PERMISSION_DENIED', detail: 'Termux helper token is unavailable.' };
    }
    const boundedLimit = Math.min(Math.max(limit, 1), TERMUX_HELPER_MAX_CHUNK_BYTES);
    return readHelperArtifactChunk(artifactId, offset, boundedLimit, operationId, token);
  }
}
