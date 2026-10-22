import { loadSystemStatusSnapshot, type SystemStatusSnapshot } from './systemStatusService';
import { profileRevision } from '@/core/state/environmentProfile';
export interface EnvironmentSample { snapshot: SystemStatusSnapshot; sampledAt: number; revision: number }
let pending: Promise<EnvironmentSample> | undefined;
let pendingRevision = -1;
let sample: EnvironmentSample | undefined;
export function currentEnvironmentSample(): EnvironmentSample | undefined {
  return sample?.revision === profileRevision() ? sample : undefined;
}
/** Coalesce simultaneous screen reads; a new request always rechecks live services. */
export function refreshEnvironmentSample(force = false): Promise<EnvironmentSample> {
  const revision = profileRevision();
  if (!force && pending && pendingRevision === revision) return pending;
  pendingRevision = revision;
  const request = loadSystemStatusSnapshot().then(snapshot => {
    if (pending !== request || revision !== profileRevision()) throw new Error('Environment profile changed');
    sample = { snapshot, sampledAt: Date.now(), revision };
    return sample;
  }).finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}

export function environmentSummary(snapshot: SystemStatusSnapshot): string {
  return [snapshot.termux, snapshot.kali, snapshot.database, snapshot.metasploit].every(status => status.ok)
    ? 'All four environment checks verified.'
    : 'Some services need attention. Open Setup for details.';
}
