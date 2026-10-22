import { createHash } from 'node:crypto';
import { File } from 'expo-file-system';
import { downloadAndFinalizeArtifact, MAX_ARTIFACT_BYTES } from './artifactDownloader';

// A byte-preserving filesystem double, not a canned successful native response.
jest.mock('expo-file-system', () => {
  const files = new Map<string, Uint8Array>();
  return { FileMode: { ReadWrite: 'rw' }, File: class {
    uri: string;
    constructor(value: string) { this.uri = value; }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri)?.length ?? 0; }
    create() { files.set(this.uri, new Uint8Array()); }
    delete() { files.delete(this.uri); }
    bytes() { return files.get(this.uri)!; }
    move(destination: {uri: string}) { files.set(destination.uri, files.get(this.uri)!); files.delete(this.uri); }
    open() {
      const uri = this.uri;
      return {offset: 0, close() {}, writeBytes(bytes: Uint8Array) {
        const previous = files.get(uri)!;
        const next = new Uint8Array(this.offset + bytes.length);
        next.set(previous.subarray(0, this.offset)); next.set(bytes, this.offset);
        files.set(uri, next); this.offset += bytes.length;
      }};
    }
  }};
});
jest.mock('expo-crypto', () => ({CryptoDigestAlgorithm: {SHA256: 'sha256'}, digest: async (_: string, bytes: Uint8Array) => jest.requireActual<typeof import('node:crypto')>('node:crypto').createHash('sha256').update(bytes).digest('hex')}));
let sequence = 0;
function setup(bytes = new Uint8Array(150003).map((_, index) => index % 251)) {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const readArtifactChunk = jest.fn(async (artifactId: string, offset: number, limit: number, operationId: string) => ({ok: true, payload: JSON.stringify({artifactId, operationId, offset, totalSize: bytes.length, sha256: hash, eof: offset + limit >= bytes.length, dataBase64: Buffer.from(bytes.subarray(offset, offset + limit)).toString('base64')})}));
  return {bytes, hash, options: {artifactId: 'artifact', operationId: 'operation', destinationUri: `file:///test-${sequence++}`, helper: {readArtifactChunk}}};
}

it('preserves bytes and hashes across multiple padded base64 chunks', async () => {
  const {options, bytes, hash} = setup();
  expect(await downloadAndFinalizeArtifact(options)).toEqual({ok: true, size: bytes.length, hash});
  expect(await new File(options.destinationUri).bytes()).toEqual(bytes);
});
it('resumes after transport loss and hashes both saved and downloaded bytes', async () => {
  const {options, bytes, hash} = setup();
  const normal = options.helper.readArtifactChunk.getMockImplementation()!;
  options.helper.readArtifactChunk.mockImplementationOnce(normal).mockImplementationOnce(async () => ({ok: false, payload: ''}));
  expect((await downloadAndFinalizeArtifact(options)).ok).toBe(false);
  expect((await downloadAndFinalizeArtifact(options)).hash).toBe(hash);
  expect(await new File(options.destinationUri).bytes()).toEqual(bytes);
  expect(options.helper.readArtifactChunk.mock.calls[2]?.[1]).toBe(65536);
});
it.each([
  {offset: 1}, {artifactId: 'other'}, {operationId: 'other'}, {totalSize: MAX_ARTIFACT_BYTES + 1},
  {dataBase64: '!'}, {dataBase64: '', eof: false}, {sha256: 'a'.repeat(64)}, {eof: true},
])('rejects invalid/corrupt chunks: %p', async (change) => {
  const {options} = setup();
  const normal = options.helper.readArtifactChunk.getMockImplementation()!;
  options.helper.readArtifactChunk.mockImplementationOnce(async (...args) => {
    const response = await normal(...args);
    return {...response, payload: JSON.stringify({...JSON.parse(response.payload), ...change})};
  });
  expect((await downloadAndFinalizeArtifact(options)).ok).toBe(false);
  expect(new File(options.destinationUri).exists).toBe(false);
});
it('deduplicates concurrent downloads of the same destination', async () => {
  const {options} = setup(new Uint8Array([1, 2, 3]));
  await Promise.all([downloadAndFinalizeArtifact(options), downloadAndFinalizeArtifact(options)]);
  expect(options.helper.readArtifactChunk).toHaveBeenCalledTimes(1);
});
