import { setupProgressPresentation } from './setupPresentation.model';
import { parseSetupInspection, toSetupJobSpec } from '@/core/integrations/termux/setupService';
it('reports only measured download progress, never overall time completion', () => {
 expect(setupProgressPresentation({phase:'downloading',downloadedBytes:50,totalBytes:100}).percent).toBe(50);
 expect(setupProgressPresentation({phase:'extracting',downloadedBytes:100,totalBytes:100}).percent).toBeUndefined();
 expect(setupProgressPresentation({phase:'downloading',downloadedBytes:110,totalBytes:100}).percent).toBeUndefined();
 expect(setupProgressPresentation({phase:'installing_tools',cancelDeferred:true}).cancelLabel).toBe('Stop after this step');
});
it('rejects malformed readiness and creates a fixed setup request', () => {
 expect(parseSetupInspection('{"ok":true,"pythonReady":"yes"}').ok).toBe(false);
 expect(parseSetupInspection('{"ok":true,"pythonReady":true}').pythonReady).toBe(true);
 const spec=toSetupJobSpec('nethunter','fixture');
 expect(spec.command).toBeUndefined();
 expect(spec.parameters).toEqual({catalogId:'kali-2026.2-minimal-arm64-v1'});
});
