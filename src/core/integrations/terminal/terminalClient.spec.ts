import { Terminal } from '~/modules/terminal/src';
import { openTerminal } from './terminalClient';
import { defaultCapabilityResolver } from '@/core/capabilities/resolver';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { requireSetupAccess } from '@/core/state/setupReadiness';
import { probeMetasploitDatabaseConnection } from '@/core/integrations/metasploit/metasploitClient';
jest.mock('@/core/integrations/metasploit/metasploitClient', () => ({probeMetasploitDatabaseConnection:jest.fn()}));
jest.mock('@/core/capabilities/resolver', () => ({defaultCapabilityResolver:{resolve:jest.fn()}}));
jest.mock('@/core/security/termuxHelperToken', () => ({getTermuxHelperToken:jest.fn(async () => 'private-token')}));
beforeEach(() => {
  jest.mocked(defaultCapabilityResolver.resolve).mockResolvedValue({capabilityId:'terminal.session',resolved:true});
  jest.mocked(Terminal.detect).mockResolvedValue({ok:true,presets:['termux']});
});
afterEach(() => jest.clearAllMocks());
it('checks the terminal capability and supported preset immediately before starting', async () => {
  await openTerminal('termux');
  expect(defaultCapabilityResolver.resolve).toHaveBeenCalledWith({capabilityId:'terminal.session'});
  expect(Terminal.start).toHaveBeenCalledWith('private-token','termux');
});
it('does not start an unavailable Kali preset', async () => {
  await expect(openTerminal('kali')).rejects.toThrow('NetHunter');
  expect(Terminal.start).not.toHaveBeenCalled();
});
it('does not expose a start path without capability or pairing', async () => {
  jest.mocked(defaultCapabilityResolver.resolve).mockResolvedValueOnce({capabilityId:'terminal.session',resolved:false});
  await expect(openTerminal('termux')).rejects.toThrow('helper');
  jest.mocked(getTermuxHelperToken).mockResolvedValueOnce(null);
  await expect(openTerminal('termux')).rejects.toThrow('pairing');
  expect(Terminal.start).not.toHaveBeenCalled();
});
it('blocks a new Kali session at execution time but leaves Termux repair accessible', async () => {
  jest.mocked(requireSetupAccess).mockRejectedValueOnce(new Error('Finish Setup'));
  await expect(openTerminal('kali')).rejects.toThrow('Finish Setup');
  expect(Terminal.start).not.toHaveBeenCalled();
  await openTerminal('termux');
  expect(Terminal.start).toHaveBeenCalledWith('private-token','termux');
  expect(requireSetupAccess).toHaveBeenCalledTimes(1);
});
it('starts an embedded Metasploit session only after authenticated Framework verification', async () => {
  jest.mocked(Terminal.detect).mockResolvedValue({ok:true,presets:['termux','kali','metasploit']});
  jest.mocked(probeMetasploitDatabaseConnection).mockResolvedValue({ok:true,connected:true,schemaReady:true});
  await openTerminal('metasploit');
  expect(requireSetupAccess).toHaveBeenCalledTimes(1);
  expect(probeMetasploitDatabaseConnection).toHaveBeenCalledTimes(1);
  expect(Terminal.start).toHaveBeenCalledWith('private-token','metasploit');
});
it.each([
  {ok:false,connected:true,schemaReady:true},
  {ok:true,connected:false,schemaReady:true},
  {ok:true,connected:true,schemaReady:false},
])('rejects Metasploit when Framework is not ready: %j', async verification => {
  jest.mocked(Terminal.detect).mockResolvedValue({ok:true,presets:['metasploit']});
  jest.mocked(probeMetasploitDatabaseConnection).mockResolvedValue(verification);
  await expect(openTerminal('metasploit')).rejects.toThrow('Framework database');
  expect(Terminal.start).not.toHaveBeenCalled();
});
it('blocks Metasploit when setup is incomplete or the installed helper lacks the preset', async () => {
  jest.mocked(requireSetupAccess).mockRejectedValueOnce(new Error('Finish Setup'));
  await expect(openTerminal('metasploit')).rejects.toThrow('Finish Setup');
  await expect(openTerminal('metasploit')).rejects.toThrow('Update the helper');
  expect(probeMetasploitDatabaseConnection).not.toHaveBeenCalled();
  expect(Terminal.start).not.toHaveBeenCalled();
});
jest.mock('@/core/state/setupReadiness', () => ({checkSetupAccess: jest.fn(async () => ({allowed:true})), requireSetupAccess: jest.fn(async () => {})}));
