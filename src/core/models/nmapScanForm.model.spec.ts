import {
  createNmapScanFormValue,
  toNmapJobSpecFromForm,
  validateNmapScanFormValue,
} from '@/core/models/nmapScanForm.model';

describe('nmapScanForm model', () => {
  it('creates defaults with bounded timeout and explicit ports', () => {
    const value = createNmapScanFormValue();
    expect(value.ports).toBe('22,80,443');
    expect(value.serviceDetection).toBe(true);
  });

  it('validates targets, ports, and project context', () => {
    const invalid = validateNmapScanFormValue(createNmapScanFormValue(), { projectId: null });
    expect(invalid.ok).toBe(false);

    const value = createNmapScanFormValue();
    value.target = '192.168.1.50';
    value.ports = '22,80';
    const valid = validateNmapScanFormValue(value, { projectId: 'proj-abc' });
    expect(valid.ok).toBe(true);
    expect(valid.executionParams?.target).toBe('192.168.1.50');
  });

  it('maps valid execution params to a job spec', () => {
    const value = createNmapScanFormValue();
    value.target = '127.0.0.1';
    value.ports = '22';
    const validated = validateNmapScanFormValue(value, { projectId: 'proj-abc' });
    expect(validated.ok).toBe(true);
    const spec = toNmapJobSpecFromForm('job-1', validated.executionParams!);
    expect(spec.command?.args).toContain('-Pn');
  });
});
