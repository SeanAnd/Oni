import { newEntityId } from '@/core/storage/ids';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { TermuxLocalPostgreSqlClient } from './termuxLocalClient';
import type { DatabaseLifecycleRequest, DatabaseLifecycleResponse, DatabaseOperation } from '@/core/models/databaseContracts.model';
import { holdProfile, readEnvironmentProfile } from '@/core/state/environmentProfile';

const inFlight = new Map<string, Promise<DatabaseLifecycleResponse>>();

export async function invokeDatabaseLifecycle(operation: DatabaseOperation, options?: {backupId?: string; rollbackId?: string; confirmReplace?: boolean}): Promise<DatabaseLifecycleResponse> {
  await readEnvironmentProfile();
  const release = holdProfile();
  try {
    const profileId = await readEnvironmentProfile();
    const mutable = !['detect', 'health'].includes(operation);
    const preferences = mutable ? new PreferencesRepository(openAppStateDatabase()) : null;
    const key = `database.pending.${profileId}.${operation}`;
    const pending = preferences?.getString(key);
    const request: DatabaseLifecycleRequest = {operation, profileId, operationId: pending || newEntityId('db'), ...options};
    const payloadKey = key + '.payload';
    const shape = JSON.stringify({operation, profileId, ...options});
    if (pending && preferences?.getString(payloadKey) !== shape) return {...request, ok: false, errorKey: 'DATABASE_BUSY', detail: 'Resume the pending operation before changing its parameters.', completedAt: new Date().toISOString()} as DatabaseLifecycleResponse;
    preferences?.setString(key, request.operationId);
    preferences?.setString(payloadKey, shape);
    const client = new TermuxLocalPostgreSqlClient();
    const existing = mutable ? inFlight.get(key) : undefined;
    if (existing) return await existing;
    const work = client.invoke(request);
    if (mutable) inFlight.set(key, work);
    let response: DatabaseLifecycleResponse;
    try { response = await work; } finally { if (mutable) inFlight.delete(key); }
    if (!['DATABASE_TRANSPORT_UNAVAILABLE', 'JOB_TIMEOUT', 'DATABASE_BUSY', 'JOB_FAILED', 'DATABASE_RECOVERY_REQUIRED'].includes(response.errorKey ?? '')) preferences?.setString(key, '');
    return response;
  } finally { release(); }
}
