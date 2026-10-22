import { buildNmapArgv, buildNmapJobSpec, validateNmapScanExecutionParams } from '@/core/integrations/nmap/nmapAdapter';

describe('nmap adapter argv policy', () => {
  it('builds rootless TCP connect argv with explicit ports and optional service detection', () => {
    expect(
      buildNmapArgv({
        target: '192.168.1.10',
        ports: '22,80',
        serviceDetection: true,
      }),
    ).toEqual([
      '--unprivileged',
      '-sT',
      '-Pn',
      '-n',
      '-p',
      '22,80',
      '-oX',
      '-',
      '-sV',
      '192.168.1.10',
    ]);

    expect(
      buildNmapArgv({
        target: '10.0.0.0/28',
        ports: '443',
        serviceDetection: false,
      }),
    ).toEqual(['--unprivileged', '-sT', '-Pn', '-n', '-p', '443', '-oX', '-', '10.0.0.0/28']);
  });

  it('maps validated execution params to a structured job spec', () => {
    const spec = buildNmapJobSpec({
      jobId: 'job-nmap-1',
      projectId: 'proj-1',
      target: '127.0.0.1',
      ports: '22',
      serviceDetection: false,
      timeoutMs: 60_000,
    });
    expect(spec.type).toBe('nmap.scan');
    expect(spec.capabilityId).toBe('network.service_detection');
    expect(spec.providerId).toBe('provider.kali.nmap');
    expect(spec.command?.binary).toBe('nmap');
    expect(spec.command?.args).toContain('-sT');
  });

  it('rejects oversized targets at execution validation', () => {
    const result = validateNmapScanExecutionParams({
      projectId: 'proj-1',
      target: '10.0.0.0/24',
      ports: '80',
      serviceDetection: false,
      timeoutMs: 60_000,
    });
    expect(result.ok).toBe(false);
  });
});
