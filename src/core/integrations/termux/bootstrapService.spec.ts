import { bootstrapWorkstation } from './bootstrapService';
import { installWorkstationBundle, startWorkstationHelper } from './termuxBridgeClient';
import { getTermuxHelperToken, setTermuxHelperToken } from '@/core/security/termuxHelperToken';
jest.mock('./termuxBridgeClient', () => ({installWorkstationBundle: jest.fn(), startWorkstationHelper: jest.fn(async () => ({ok: true}))}));
jest.mock('@/core/security/termuxHelperToken', () => ({getTermuxHelperToken: jest.fn(), setTermuxHelperToken: jest.fn()}));
jest.mock('@/core/security/randomSecret', () => ({generateRandomSecret: () => 'generated-pairing'}));
beforeEach(() => jest.clearAllMocks());
it('does not replace valid saved pairing after a rejected repair', async () => {
  jest.mocked(getTermuxHelperToken).mockResolvedValue('original-pairing');
  jest.mocked(installWorkstationBundle).mockResolvedValue({ok: false, errorKey: 'PERMISSION_DENIED'});
  expect((await bootstrapWorkstation('incorrect-repair')).ok).toBe(false);
  expect(setTermuxHelperToken).not.toHaveBeenCalled();
  expect(startWorkstationHelper).not.toHaveBeenCalled();
});
it('persists a new token before any transfer and retains it after interrupted installation', async () => {
  jest.mocked(getTermuxHelperToken).mockResolvedValue(null);
  jest.mocked(installWorkstationBundle).mockImplementation(async token => {
    expect(setTermuxHelperToken).toHaveBeenCalledWith(token);
    return {ok: false, errorKey: 'JOB_TIMEOUT'};
  });
  await bootstrapWorkstation();
  expect(setTermuxHelperToken).toHaveBeenCalledTimes(1);
  expect(setTermuxHelperToken).toHaveBeenCalledWith('generated-pairing');
});
