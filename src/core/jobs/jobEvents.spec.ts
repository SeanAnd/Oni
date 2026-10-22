import { applyEventIdempotent, buildIdempotencyKey } from '@/core/jobs/jobEvents';

describe('job event idempotency', () => {
  it('accepts the first event for a key and rejects duplicates', () => {
    const seen = new Set<string>();
    const event = {
      jobId: 'job-1',
      sequence: 1,
      type: 'job.completed' as const,
      idempotencyKey: buildIdempotencyKey('job-1', 'completed'),
      emittedAt: '2026-01-01T00:00:00.000Z',
      payload: { exitCode: 0 },
    };
    expect(applyEventIdempotent(seen, event)).toBe(true);
    expect(applyEventIdempotent(seen, event)).toBe(false);
  });
});
