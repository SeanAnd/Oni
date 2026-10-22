import { invokeDatabaseLifecycle } from './databaseLifecycleService';
import { TermuxLocalPostgreSqlClient } from './termuxLocalClient';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import type { DatabaseLifecycleResponse } from '@/core/models/databaseContracts.model';
jest.mock('@/core/state/environmentProfile', () => ({readEnvironmentProfile: async () => 'termux-local', holdProfile: () => () => undefined}));
jest.mock('./termuxLocalClient');
const invoke = jest.mocked(TermuxLocalPostgreSqlClient.prototype.invoke);
let db: SqlDatabase;
beforeEach(() => { db = installTestAppStateDatabase(); invoke.mockImplementation(async request => ({...request,ok: true,completedAt:'test'}) as DatabaseLifecycleResponse); });
afterEach(() => { resetTestAppStateDatabase(); jest.clearAllMocks(); });
it('retains uncertain device mutation identity across retries, then clears it', async () => {
  invoke.mockImplementationOnce(async request => ({...request,ok:false,errorKey:'DATABASE_TRANSPORT_UNAVAILABLE',completedAt:'test'}) as DatabaseLifecycleResponse);
  await invokeDatabaseLifecycle('start');
  const first = invoke.mock.calls[0][0];
  expect(new PreferencesRepository(db).getString('database.pending.termux-local.start')).toBe(first.operationId);
  await invokeDatabaseLifecycle('start');
  expect(invoke.mock.calls[1][0].operationId).toBe(first.operationId);
  await invokeDatabaseLifecycle('start');
  expect(invoke.mock.calls[2][0].operationId).not.toBe(first.operationId);
});
it('never dispatches host requests or translates legacy operation IDs onto the device', async () => {
  const preferences = new PreferencesRepository(db);
  preferences.setString('database.pending.start','legacy-operation');
  preferences.setString('database.pending.retired-profile.start','host-operation');
  await invokeDatabaseLifecycle('start');
  expect(invoke.mock.calls[0][0]).toMatchObject({profileId:'termux-local'});
  expect(invoke.mock.calls[0][0].operationId).not.toBe('legacy-operation');
  expect(preferences.getString('database.pending.start')).toBe('legacy-operation');
  expect(preferences.getString('database.pending.retired-profile.start')).toBe('host-operation');
});
it('preserves maintenance parameters and refuses a different backup while a restore is uncertain', async () => {
  invoke.mockImplementationOnce(async request => ({...request, ok: false, errorKey: 'DATABASE_TRANSPORT_UNAVAILABLE', completedAt: 'test'}) as DatabaseLifecycleResponse);
  await invokeDatabaseLifecycle('restore', {backupId: 'backup-1', confirmReplace: true});
  expect(invoke.mock.calls[0][0]).toMatchObject({operation: 'restore', profileId: 'termux-local', backupId: 'backup-1', confirmReplace: true});
  expect(await invokeDatabaseLifecycle('restore', {backupId: 'backup-2', confirmReplace: true})).toMatchObject({ok: false, errorKey: 'DATABASE_BUSY'});
  expect(invoke).toHaveBeenCalledTimes(1);
  await invokeDatabaseLifecycle('restore', {backupId: 'backup-1', confirmReplace: true});
  expect(invoke.mock.calls[1][0]).toEqual(invoke.mock.calls[0][0]);
});
it('reads get fresh identities without persisting pending operations', async () => {
  await invokeDatabaseLifecycle('health'); await invokeDatabaseLifecycle('health');
  expect(invoke.mock.calls[0][0].operationId).not.toBe(invoke.mock.calls[1][0].operationId);
  expect(new PreferencesRepository(db).getString('database.pending.termux-local.health')).toBeNull();
});
