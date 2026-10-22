import { checkSetupAccess } from '@/core/state/setupReadiness';
import { acknowledgeMetasploitConsoleLaunch } from './metasploitClient';
import { launchMetasploitConsole, verifyMetasploitDatabase } from '@/core/integrations/termux/termuxBridgeClient';

jest.mock('@/core/state/environmentProfile', () => ({readEnvironmentProfile: async () => 'termux-local', holdProfile: () => () => undefined}));
jest.mock('@/core/integrations/termux/termuxBridgeClient', () => ({
  launchMetasploitConsole: jest.fn(), verifyMetasploitDatabase: jest.fn(),
}));
beforeEach(() => jest.mocked(checkSetupAccess).mockResolvedValue({allowed:true}));
afterEach(() => jest.resetAllMocks());

it.each([
  {ok: false, errorKey: 'DATABASE_TRANSPORT_UNAVAILABLE' as const},
  {ok: true, connected: false, schemaReady: true},
  {ok: true, connected: true, schemaReady: false},
])('refuses console launch when current Framework verification fails: %p', async (result) => {
  jest.mocked(verifyMetasploitDatabase).mockResolvedValue(result);
  expect(await acknowledgeMetasploitConsoleLaunch()).toMatchObject({ok: false});
  expect(launchMetasploitConsole).not.toHaveBeenCalled();
});
it('rechecks Framework health on each launch and propagates native launch errors', async () => {
  jest.mocked(verifyMetasploitDatabase).mockResolvedValue({ok: true, connected: true, schemaReady: true});
  jest.mocked(launchMetasploitConsole).mockResolvedValue({ok: false, errorKey: 'TERMUX_PERMISSION_DENIED'});
  expect(await acknowledgeMetasploitConsoleLaunch()).toMatchObject({ok: false, errorKey: 'TERMUX_PERMISSION_DENIED'});
  expect(launchMetasploitConsole).toHaveBeenCalledTimes(1);
  jest.mocked(verifyMetasploitDatabase).mockResolvedValue({ok: true, connected: false});
  await acknowledgeMetasploitConsoleLaunch();
  expect(verifyMetasploitDatabase).toHaveBeenCalledTimes(2);
  expect(launchMetasploitConsole).toHaveBeenCalledTimes(1);
});
it('blocks direct console launch before Framework work when setup cannot be checked', async () => {
  jest.mocked(checkSetupAccess).mockResolvedValue({allowed:false,errorKey:'SETUP_STATUS_UNAVAILABLE',detail:'Retry Setup'});
  expect(await acknowledgeMetasploitConsoleLaunch()).toMatchObject({ok:false,errorKey:'SETUP_STATUS_UNAVAILABLE'});
  expect(verifyMetasploitDatabase).not.toHaveBeenCalled();
  expect(launchMetasploitConsole).not.toHaveBeenCalled();
});
jest.mock('@/core/state/setupReadiness', () => ({checkSetupAccess: jest.fn(async () => ({allowed:true})), requireSetupAccess: jest.fn(async () => {})}));
