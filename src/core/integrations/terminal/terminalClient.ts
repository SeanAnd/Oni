import { requireSetupAccess } from '@/core/state/setupReadiness';
import { Terminal } from '~/modules/terminal/src';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { defaultCapabilityResolver } from '@/core/capabilities/resolver';
import type { TerminalPreset } from '@/core/models/terminalSession.model';
import { probeMetasploitDatabaseConnection } from '@/core/integrations/metasploit/metasploitClient';
export const terminalStatus = () => Terminal.status();
export const closeTerminal = () => Terminal.close();
export async function openTerminal(preset: TerminalPreset) {
  if (preset !== 'termux') await requireSetupAccess();
  const availability = await defaultCapabilityResolver.resolve({ capabilityId: 'terminal.session' });
  if (!availability.resolved) throw new Error('Install/update the helper in Settings and grant Run commands in Termux.');
  const detection = await Terminal.detect();
  if (!detection.ok || !detection.presets.includes(preset)) throw new Error(preset === 'metasploit' ? 'Update the helper and verify Metasploit in Setup before starting its terminal.' : preset === 'kali' ? 'Install NetHunter Rootless before starting a Kali terminal.' : 'A Termux PTY is unavailable. Recover the helper and retry.');
  if (preset === 'metasploit') {
    const verification = await probeMetasploitDatabaseConnection();
    if (!verification.ok || !verification.connected || !verification.schemaReady) {
      throw new Error('Verify the Framework database connection in Setup before opening the console.');
    }
  }
  const token = await getTermuxHelperToken();
  if (!token) throw new Error('Recover local helper pairing in Settings.');
  return Terminal.start(token, preset);
}
