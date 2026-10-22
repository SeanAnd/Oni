import {
  validateJobEventEnvelope,
  validateJobResultPayload,
  validateJobSpecPayload,
  validateObservationPayload,
  validateStructuredCommand,
} from '@/core/validators/boundaryPayload.validators';

describe('boundary payload validators', () => {
  it('accepts structured command arrays', () => {
    const result = validateStructuredCommand({
      binary: 'nmap',
      args: ['-sT', '127.0.0.1'],
    });
    expect(result.ok).toBe(true);
  });

  it('rejects interpolated-shell-style command payloads', () => {
    const result = validateStructuredCommand({ binary: 'sh', args: 1 });
    expect(result).toEqual({
      ok: false,
      errorKey: 'INVALID_PAYLOAD',
      issues: ['command.args must be an array of strings'],
    });
  });

  it('validates job spec payloads at the boundary', () => {
    const ok = validateJobSpecPayload({
      id: 'job-1',
      projectId: 'proj-1',
      type: 'nmap.scan',
      capabilityId: 'network.service_detection',
      providerId: 'provider.kali.nmap',
      parameters: { target: '127.0.0.1' },
    });
    expect(ok.ok).toBe(true);

    const bad = validateJobSpecPayload({ id: '', projectId: 'proj-1' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errorKey).toBe('INVALID_PAYLOAD');
    }
  });

  it('validates job results, events, and observations', () => {
    expect(
      validateJobResultPayload({
        jobId: 'job-1',
        exitCode: 0,
        artifactIds: [],
        observationsPending: false,
      }).ok,
    ).toBe(true);

    expect(
      validateJobEventEnvelope({
        type: 'job.started',
        jobId: 'job-1',
        sequence: 0,
        emittedAt: '2026-09-21T00:00:00.000Z',
      }).ok,
    ).toBe(true);

    expect(
      validateObservationPayload({
        type: 'network.service',
        source: 'nmap',
        data: { port: 443 },
      }).ok,
    ).toBe(true);
  });
});
