import { checkSetupAccess } from '@/core/state/setupReadiness';
import { saveDatabasePassword } from '@/core/security/databaseCredentials';
import { readEnvironmentProfile, holdProfile } from '@/core/state/environmentProfile';
import {
  configureMetasploitDatabase,
  launchMetasploitConsole,
  verifyMetasploitDatabase,
  type MetasploitDatabaseConfigRequest,
  type MetasploitScriptResult,
} from '@/core/integrations/termux/termuxBridgeClient';

export type { MetasploitScriptResult };

export async function writeMetasploitDatabaseConfig(
  request: MetasploitDatabaseConfigRequest,
): Promise<MetasploitScriptResult> {
  await readEnvironmentProfile();
  const release = holdProfile();
  try {
    const profileId = await readEnvironmentProfile();
    const result = await configureMetasploitDatabase({...request, profileId});
    if (result.ok && result.configured) await saveDatabasePassword(profileId, request.password);
    return result;
  } finally { release(); }
}

export async function probeMetasploitDatabaseConnection(): Promise<MetasploitScriptResult> {
  await readEnvironmentProfile();
  const release = holdProfile();
  try { return await verifyMetasploitDatabase(await readEnvironmentProfile()); } finally { release(); }
}

export async function acknowledgeMetasploitConsoleLaunch(): Promise<MetasploitScriptResult> {
  const setup = await checkSetupAccess();
  if (!setup.allowed) return {ok:false,errorKey:setup.errorKey,detail:setup.detail};
  await readEnvironmentProfile();
  const release = holdProfile();
  try {
    const profile = await readEnvironmentProfile();
    const verification = await verifyMetasploitDatabase(profile);
    if (!verification.ok || !verification.connected || !verification.schemaReady) {
      return {ok: false, errorKey: verification.errorKey ?? 'METASPLOIT_UNAVAILABLE', detail: 'Verify the Framework database connection before opening the console.'};
    }
    return await launchMetasploitConsole(profile);
  } finally { release(); }
}
