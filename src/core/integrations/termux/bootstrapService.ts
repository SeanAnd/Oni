import { installWorkstationBundle, startWorkstationHelper } from './termuxBridgeClient';
import { generateRandomSecret } from '@/core/security/randomSecret';
import { getTermuxHelperToken, setTermuxHelperToken } from '@/core/security/termuxHelperToken';

export async function bootstrapWorkstation(repairToken?: string, onActivity: (activity: 'installing_helper' | 'starting_helper') => Promise<void> = async () => undefined) {
  const existing = await getTermuxHelperToken();
  const repair = repairToken?.trim();
  const token = repair || existing || generateRandomSecret();
  // Persist brand-new pairing before delivery, but never replace an existing app
  // token until Termux has verified an explicitly supplied repair token.
  if (!existing && !repair) await setTermuxHelperToken(token);
  await onActivity('installing_helper');
  const installed = await installWorkstationBundle(token);
  if (!installed.ok) return installed;
  await setTermuxHelperToken(token);
  await onActivity('starting_helper');
  return startWorkstationHelper(token);
}

export async function recoverWorkstationHelper() {
  const token = await getTermuxHelperToken();
  if (!token) return {ok: false, detail: 'Complete workstation setup to pair the helper.'};
  return startWorkstationHelper(token);
}
