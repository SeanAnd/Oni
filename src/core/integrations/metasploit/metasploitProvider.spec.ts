import { metasploitProvider } from './metasploitProvider';
import { probeMetasploitDatabaseConnection } from './metasploitClient';
import { termuxPostgresqlProvider } from '@/core/integrations/postgresql/termuxPostgresqlProvider';
import { getTermuxStatus } from '@/core/integrations/termux/termuxBridgeClient';
jest.mock('@/core/state/environmentProfile', () => ({readEnvironmentProfile: async () => 'termux-local', holdProfile: () => () => undefined}));

jest.mock('./metasploitClient', () => ({probeMetasploitDatabaseConnection: jest.fn()}));
jest.mock('@/core/integrations/postgresql/termuxPostgresqlProvider', () => ({termuxPostgresqlProvider: {detect: jest.fn()}}));
jest.mock('@/core/integrations/termux/termuxBridgeClient', () => ({getTermuxStatus: jest.fn()}));
beforeEach(() => {
  jest.mocked(termuxPostgresqlProvider.detect).mockResolvedValue({providerId: 'provider.termux.postgresql', detected: true});
  jest.mocked(getTermuxStatus).mockResolvedValue({installed: true, permissionGranted: true});
  jest.mocked(probeMetasploitDatabaseConnection).mockResolvedValue({ok: true, connected: true, schemaReady: true});
});
afterEach(() => jest.resetAllMocks());

it('uses one Framework probe for both advertisements without caching across execution checks', async () => {
  expect((await metasploitProvider.listCapabilities()).map((item) => item.available)).toEqual([true, true]);
  expect(probeMetasploitDatabaseConnection).toHaveBeenCalledTimes(1);
  await metasploitProvider.listCapabilities();
  expect(probeMetasploitDatabaseConnection).toHaveBeenCalledTimes(2);
});
it.each([
  {ok: false, connected: false, schemaReady: false},
  {ok: true, connected: false, schemaReady: false},
  {ok: true, connected: true, schemaReady: false},
])('keeps both capabilities unavailable without full Framework readiness: %p', async (probe) => {
  jest.mocked(probeMetasploitDatabaseConnection).mockResolvedValue(probe);
  expect((await metasploitProvider.listCapabilities()).map((item) => item.available)).toEqual([false, false]);
});
it('does not invoke Framework when the device database is unavailable', async () => {
  jest.mocked(termuxPostgresqlProvider.detect).mockResolvedValue({providerId: 'provider.termux.postgresql', detected: false, errorKey: 'DATABASE_TRANSPORT_UNAVAILABLE'});
  expect((await metasploitProvider.detect()).detected).toBe(false);
  expect(probeMetasploitDatabaseConnection).not.toHaveBeenCalled();
});
