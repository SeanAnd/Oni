import { finishWorkstationSetup } from './finishWorkstationSetup';
import { invokeDatabaseLifecycle } from '@/core/integrations/postgresql/databaseLifecycleService';
import { writeMetasploitDatabaseConfig } from '@/core/integrations/metasploit/metasploitClient';
import { prepareMetasploitSchema } from '@/core/integrations/metasploit/metasploitSetupJob';

jest.mock('@/core/integrations/postgresql/databaseLifecycleService', () => ({invokeDatabaseLifecycle: jest.fn()}));
jest.mock('@/core/integrations/metasploit/metasploitClient', () => ({writeMetasploitDatabaseConfig: jest.fn()}));
jest.mock('@/core/integrations/metasploit/metasploitSetupJob', () => ({prepareMetasploitSchema: jest.fn()}));
jest.mock('@/core/security/databaseCredentials', () => ({ensureDeviceDatabasePassword: async () => 'test-only'}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(invokeDatabaseLifecycle).mockImplementation(async operation => ({ok: true, operation, packageInstalled: true}) as never);
  jest.mocked(writeMetasploitDatabaseConfig).mockResolvedValue({ok: true, configured: true});
  jest.mocked(prepareMetasploitSchema).mockResolvedValue({ok: true, connected: true, schemaReady: true});
});
it('reuses installed PostgreSQL and saves each successful boundary before continuing', async () => {
  const completed = jest.fn(async (_step: string, _outcome?: string) => undefined);
  expect((await finishWorkstationSetup('database_initialize', jest.fn(), completed)).ok).toBe(true);
  expect(jest.mocked(invokeDatabaseLifecycle).mock.calls.map(call => call[0])).toEqual(['detect', 'initialize', 'start']);
  expect(completed.mock.calls.map(call => call[0])).toEqual(['database_initialize', 'database_start', 'metasploit_config', 'metasploit_verify']);
  expect(completed.mock.calls[0][1]).toContain('already installed');
});
it('stops on credential failure without configuring or claiming success', async () => {
  jest.mocked(invokeDatabaseLifecycle).mockImplementation(async operation => ({ok: operation === 'detect', operation, packageInstalled: true, errorKey: 'DATABASE_CREDENTIALS_INVALID'}) as never);
  const completed = jest.fn(async (_step: string, _outcome?: string) => undefined);
  expect((await finishWorkstationSetup('database_initialize', jest.fn(), completed)).ok).toBe(false);
  expect(completed).not.toHaveBeenCalled();
  expect(writeMetasploitDatabaseConfig).not.toHaveBeenCalled();
});
it('resumes the saved stage and requires verified Framework schema', async () => {
  jest.mocked(prepareMetasploitSchema).mockResolvedValue({ok: true, connected: true, schemaReady: false});
  const completed = jest.fn(async (_step: string, _outcome?: string) => undefined);
  expect((await finishWorkstationSetup('metasploit_verify', jest.fn(), completed)).ok).toBe(false);
  expect(invokeDatabaseLifecycle).not.toHaveBeenCalled();
  expect(completed).not.toHaveBeenCalled();
});

it('reports the specific work before dispatching each database operation', async () => {
  const events: string[] = [];
  jest.mocked(invokeDatabaseLifecycle).mockImplementation(async operation => {
    events.push(operation);
    return {ok:true,operation,packageInstalled:false} as never;
  });
  await finishWorkstationSetup('database_initialize', jest.fn(), async () => undefined, async (_step, activity) => {events.push(activity);});
  expect(events).toEqual(['detecting_database','detect','installing_database','install','initializing_database','initialize','starting_database','start','configuring_framework','verifying_framework']);
});
