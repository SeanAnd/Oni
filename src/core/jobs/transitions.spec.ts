import {
  assertJobTransition,
  canTransitionJobStatus,
  IllegalJobTransitionError,
  isTerminalJobStatus,
  nextStatusesFrom,
} from '@/core/jobs/transitions';

describe('job status transitions', () => {
  it('allows the documented lifecycle paths', () => {
    expect(canTransitionJobStatus('queued', 'starting')).toBe(true);
    expect(canTransitionJobStatus('starting', 'running')).toBe(true);
    expect(canTransitionJobStatus('running', 'waiting_for_device')).toBe(true);
    expect(canTransitionJobStatus('waiting_for_device', 'running')).toBe(true);
    expect(canTransitionJobStatus('running', 'completed')).toBe(true);
    expect(canTransitionJobStatus('starting', 'failed')).toBe(true);
    expect(canTransitionJobStatus('queued', 'cancelled')).toBe(true);
  });

  it('rejects terminal overwrites', () => {
    expect(canTransitionJobStatus('completed', 'running')).toBe(false);
    expect(canTransitionJobStatus('failed', 'queued')).toBe(false);
    expect(canTransitionJobStatus('cancelled', 'starting')).toBe(false);
  });

  it('exposes next statuses and terminal detection', () => {
    expect(nextStatusesFrom('queued')).toEqual(['starting', 'cancelled']);
    expect(isTerminalJobStatus('completed')).toBe(true);
    expect(isTerminalJobStatus('running')).toBe(false);
  });

  it('throws IllegalJobTransitionError on invalid moves', () => {
    expect(() => assertJobTransition('completed', 'running')).toThrow(IllegalJobTransitionError);
    try {
      assertJobTransition('completed', 'running');
    } catch (error) {
      expect(error).toMatchObject({
        errorKey: 'JOB_ILLEGAL_TRANSITION',
        from: 'completed',
        to: 'running',
      });
    }
  });
});
