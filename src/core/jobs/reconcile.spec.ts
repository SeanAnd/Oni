import { reconcileTerminalFromHelper, shouldApplyCancel } from '@/core/jobs/reconcile';

describe('job reconciliation', () => {
  it('prefers helper terminal status over re-running', () => {
    const decision = reconcileTerminalFromHelper('running', {
      status: 'completed',
      exitCode: 0,
      artifactIds: ['art-1'],
    });
    expect(decision).toEqual({
      action: 'complete',
      exitCode: 0,
      artifactIds: ['art-1'],
      observationsPending: true,
    });
  });

  it('does not overwrite an already terminal job', () => {
    expect(reconcileTerminalFromHelper('completed', { status: 'failed' })).toEqual({
      action: 'noop',
      reason: 'already_terminal',
    });
  });

  it('falls back to the RUN_COMMAND envelope when helper status is unknown', () => {
    const decision = reconcileTerminalFromHelper(
      'running',
      { status: 'running' },
      { ok: false, errorKey: 'JOB_TIMEOUT', exitCode: 124 },
    );
    expect(decision).toEqual({
      action: 'apply_envelope',
      envelope: { ok: false, errorKey: 'JOB_TIMEOUT', exitCode: 124 },
    });
  });

  it('blocks cancel when completion already landed', () => {
    expect(shouldApplyCancel('completed')).toBe(false);
    expect(shouldApplyCancel('running')).toBe(true);
  });
});
