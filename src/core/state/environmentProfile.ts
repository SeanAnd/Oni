import { listJobSummaries } from '@/core/jobs/jobClient';
import * as SecureStore from 'expo-secure-store';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
const KEY='skid.environment.profile.v1';
const MIGRATION='oni.environment.device-only.v1';
let revision=0;
let activeOperations=0;
let pending:Promise<EnvironmentProfileId>|undefined;
/** Retire selection only. Legacy credentials, progress and host data remain untouched. */
export function readEnvironmentProfile():Promise<EnvironmentProfileId> {
  if(!pending)pending=readStoredProfile().finally(()=>{pending=undefined});
  return pending;
}
async function readStoredProfile():Promise<EnvironmentProfileId> {
  const previous=await SecureStore.getItemAsync(KEY);
  const marker=await SecureStore.getItemAsync(MIGRATION);
  if(previous!=='termux-local') {
    if(activeOperations)throw new Error('DATABASE_BUSY');
    const jobs = await listJobSummaries();
    if (jobs.some(job => job.providerId === 'provider.termux.postgresql' && (job.type.startsWith('database.') || job.type === 'metasploit.prepare') && !['completed', 'failed', 'cancelled'].includes(job.status))) throw new Error('DATABASE_BUSY');
    if(!marker)await SecureStore.setItemAsync(MIGRATION,JSON.stringify({previous:previous??'legacy-or-new',version:1}));
    await SecureStore.setItemAsync(KEY,'termux-local');
    revision+=1;
  }
  return 'termux-local';
}
export function profileRevision(){return revision}
export function holdProfile(){activeOperations+=1;return()=>{activeOperations-=1}}
export async function selectEnvironmentProfile(profile:EnvironmentProfileId):Promise<void> {
  if(profile!=='termux-local')throw new Error('INVALID_PAYLOAD');
  await readEnvironmentProfile();
}
