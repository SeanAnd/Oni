import { validDeviceDatabasePassword } from '@/core/models/databaseCredentialRepair.model';
import { databaseOperation } from '@/core/integrations/termux/termuxBridgeClient';
import { newEntityId } from '@/core/storage/ids';
import * as SecureStore from 'expo-secure-store';
import { generateRandomSecret } from './randomSecret';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';

export async function readDatabasePassword(profile: EnvironmentProfileId): Promise<string | null> {
  return SecureStore.getItemAsync(`skid.database.${profile}.password`);
}

export async function saveDatabasePassword(profile: EnvironmentProfileId, password: string): Promise<void> {
  await SecureStore.setItemAsync(`skid.database.${profile}.password`, password);
}

let creating: Promise<string> | undefined;
export async function ensureDeviceDatabasePassword(): Promise<string> {
  if (creating) return creating;
  creating = (async () => {
    const existing = await readDatabasePassword('termux-local');
    if (existing) return existing;
    const password = generateRandomSecret();
    await SecureStore.setItemAsync('skid.database.termux-local.password', password);
    return password;
  })();
  try { return await creating; } finally { creating = undefined; }
}

/** Deliberate recovery verifies the old credential before replacing only the app's copy. */
export async function repairDeviceDatabasePassword(password: string): Promise<boolean> {
  if (!validDeviceDatabasePassword(password)) return false;
  const result = await databaseOperation({profileId: 'termux-local', operation: 'health', operationId: newEntityId('credential-repair')}, password);
  if (!result.ok || result.operation !== 'health' || !result.authenticatedQueryOk) return false;
  await SecureStore.setItemAsync('skid.database.termux-local.password', password);
  return true;
}
