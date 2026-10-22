import { executeKaliHealthJob, toKaliHealthJobSpec } from '@/core/integrations/termux/kaliHealthJob';
import { __setTermuxModuleForTests } from '~/modules/termux/src/index';

describe('kali health job', () => {
  afterEach(() => {
    __setTermuxModuleForTests(null);
  });

  it('maps to a validated workstation.health job spec', () => {
    const spec = toKaliHealthJobSpec({ id: 'job-1', projectId: 'project-1' });
    expect(spec.capabilityId).toBe('workstation.health');
    expect(spec.providerId).toBe('provider.kali.health');
    expect(spec.type).toBe('workstation.kali_health');
  });

  it('returns NETHUNTER_NOT_FOUND when the native health probe fails', async () => {
    __setTermuxModuleForTests({
      probeSetup: async () => '{"ok":true,"pythonReady":true}', probeKaliSetup: async () => '{"ok":true}', openTermux: async () => true,
      checkProfileSwitch: async () => ({ok: true}),
    databaseOperation: async () => ({ok: false}),
    prepareDatabaseCredential: async () => ({ok: false}),
    installWorkstationBundle: async () => ({ok: false}),
    startWorkstationHelper: async () => ({ok: false}),
    getTermuxStatus: async () => ({ installed: true, permissionGranted: true }),
      openTermuxAppSettings: async () => false,
      runKaliHealth: async () => ({
        ok: false,
        errorKey: 'NETHUNTER_NOT_FOUND',
        detail: 'nh missing',
      }),
      runStructuredJob: async () => ({
        jobId: 'job-1',
        ok: false,
        artifactIds: [],
        observationsPending: false,
      }),
      getHelperJobStatus: async () => ({ ok: false }),
      cancelHelperJob: async () => ({ ok: false }),
      readHelperArtifactChunk: async () => ({ ok: false }),
      getBootstrapInstallCommand: async () => ({
        command: 'bash ~/skid-bootstrap/install-termux.sh',
        manifestVersion: '1.0.0',
        workstationHome: '~/.rootless-workstation',
      }),
      configureMetasploitDatabase: async () => ({ ok: false }),
      verifyMetasploitDatabase: async () => ({ ok: false }),
      launchMetasploitConsole: async () => ({ ok: false }),
    });

    const result = await executeKaliHealthJob({ id: 'job-1', projectId: 'project-1' });
    expect(result.errorKey).toBe('NETHUNTER_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });
});
