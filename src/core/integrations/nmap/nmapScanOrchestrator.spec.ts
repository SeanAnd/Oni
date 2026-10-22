import { NmapScanOrchestrator } from './nmapScanOrchestrator';
import { enqueueJobSpec } from '@/core/jobs/jobClient';
import { checkSetupAccess } from '@/core/state/setupReadiness';
import { CapabilityResolver } from '@/core/capabilities/resolver';
jest.mock('@/core/state/setupReadiness', () => ({checkSetupAccess:jest.fn()}));
jest.mock('@/core/jobs/jobClient', () => ({enqueueJobSpec:jest.fn()}));
it.each(['SETUP_REQUIRED','SETUP_STATUS_UNAVAILABLE'] as const)('blocks direct scan execution when %s', async errorKey => {
  jest.mocked(checkSetupAccess).mockResolvedValue({allowed:false,errorKey,detail:'Setup needed'});
  const resolver=new CapabilityResolver();
  const precheck=jest.spyOn(resolver,'precheckExecution');
  const result=await new NmapScanOrchestrator(resolver).startScan('scan',{projectId:'p',target:'127.0.0.1',ports:'80',timeoutMs:30000,serviceDetection:true});
  expect(result).toMatchObject({ok:false,errorKey});
  expect(precheck).not.toHaveBeenCalled();
  expect(enqueueJobSpec).not.toHaveBeenCalled();
});
