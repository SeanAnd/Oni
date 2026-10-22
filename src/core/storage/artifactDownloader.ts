import { File, FileMode } from 'expo-file-system';
import type { TermuxHelperClient } from '@/core/integrations/termux/termuxHelperClient';
import { TERMUX_HELPER_MAX_CHUNK_BYTES } from '@/core/integrations/termux/termuxHelperClient';
import { sha256HexFromBytes } from '@/core/storage/artifactHash';

export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
export interface DownloadArtifactOptions {
  artifactId: string;
  operationId: string;
  destinationUri: string;
  expectedSize?: number;
  expectedHash?: string;
  helper: Pick<TermuxHelperClient, 'readArtifactChunk'>;
}
export interface DownloadArtifactResult {
  ok: boolean;
  size: number;
  hash?: string;
  errorKey?: string;
  detail?: string;
}

// Serialize downloads of the same file, including concurrent UI/recovery requests.
const downloads = new Map<string, Promise<DownloadArtifactResult>>();
export function downloadAndFinalizeArtifact(options: DownloadArtifactOptions): Promise<DownloadArtifactResult> {
  const key = options.destinationUri;
  const pending = downloads.get(key);
  if (pending) return pending;
  const task = download(options).finally(() => downloads.delete(key));
  downloads.set(key, task);
  return task;
}

async function download(options: DownloadArtifactOptions): Promise<DownloadArtifactResult> {
  const partial = new File(`${options.destinationUri}.partial`);
  let offset = 0;
  let handle: ReturnType<File['open']> | undefined;
  try {
    if (!partial.exists) partial.create();
    offset = partial.size;
    if (offset > MAX_ARTIFACT_BYTES) throw new Error('Invalid partial size');
    handle = partial.open(FileMode.ReadWrite);
    handle.offset = offset;
    let size = options.expectedSize;
    let expectedHash = options.expectedHash;
    for (;;) {
      const response = await options.helper.readArtifactChunk(options.artifactId, offset, TERMUX_HELPER_MAX_CHUNK_BYTES, options.operationId);
      if (!response.ok) return { ok: false, size: offset, errorKey: response.errorKey ?? 'JOB_FAILED' };
      const payload = JSON.parse(response.payload ?? '') as Record<string, unknown>;
      if (payload.artifactId !== options.artifactId || payload.operationId !== options.operationId || payload.offset !== offset ||
          typeof payload.totalSize !== 'number' || !Number.isSafeInteger(payload.totalSize) || payload.totalSize < offset || payload.totalSize > MAX_ARTIFACT_BYTES ||
          typeof payload.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(payload.sha256) ||
          typeof payload.dataBase64 !== 'string' || payload.dataBase64.length > 4 * Math.ceil(TERMUX_HELPER_MAX_CHUNK_BYTES / 3) ||
          typeof payload.eof !== 'boolean') throw new Error('Invalid chunk');
      if (size !== undefined && size !== payload.totalSize || expectedHash !== undefined && expectedHash !== payload.sha256) throw new Error('Artifact changed');
      size = payload.totalSize;
      expectedHash = payload.sha256;
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.dataBase64)) throw new Error('Invalid base64');
      const bytes = Uint8Array.from(atob(payload.dataBase64), (char) => char.charCodeAt(0));
      if (bytes.length > TERMUX_HELPER_MAX_CHUNK_BYTES || offset + bytes.length > size || payload.eof !== (offset + bytes.length === size) || !payload.eof && bytes.length === 0) throw new Error('Invalid chunk length');
      handle.writeBytes(bytes);
      offset += bytes.length;
      if (payload.eof) break;
    }
    handle.close();
    handle = undefined;
    // Hash the complete bounded file, including bytes saved before a disconnect.
    const hash = await sha256HexFromBytes(await partial.bytes());
    if (offset !== size || partial.size !== size || hash !== expectedHash) throw new Error('Artifact integrity mismatch');
    partial.move(new File(options.destinationUri), { overwrite: true });
    return { ok: true, size: offset, hash };
  } catch {
    handle?.close();
    handle = undefined;
    // Invalid bytes must not poison the next retry; transport errors retain the partial.
    if (partial.exists) partial.delete();
    return { ok: false, size: offset, errorKey: 'ARTIFACT_INTEGRITY_FAILED', detail: 'Artifact transfer or integrity check failed.' };
  } finally {
    handle?.close();
  }
}
