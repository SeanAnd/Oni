import { summarizeNetHunterHealth } from '@/core/integrations/nethunter/nethunterDetector';

describe('nethunter detector', () => {
  it('marks environment detected when health probe succeeds', () => {
    const summary = summarizeNetHunterHealth({
      ok: true,
      arch: 'aarch64',
      nhPath: '/data/data/com.termux/files/home/nh',
      helperVersion: '1.0.0',
    });
    expect(summary.detected).toBe(true);
    expect(summary.arch).toBe('aarch64');
  });
});
