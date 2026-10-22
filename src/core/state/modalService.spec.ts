import { createModalService } from './modalService';
const request={title:'Confirm',body:'Continue?',primaryLabel:'Yes',secondaryLabel:'No'};
it('bounds the queue, presents one request and settles dismissal without confirmation', async () => {
  const service=createModalService(2);
  const first=service.show(request); const second=service.show({...request,title:'Second'});
  await expect(service.show(request)).resolves.toBe('dismissed');
  expect(service.getSnapshot()?.request.title).toBe('Confirm');
  service.resolve(service.getSnapshot()!.id,'secondary');
  await expect(first).resolves.toBe('secondary');
  expect(service.getSnapshot()?.request.title).toBe('Second');
  service.dismissAll();
  await expect(second).resolves.toBe('dismissed');
  expect(service.getSnapshot()).toBeNull();
});
it('deduplicates prompts and awards the resulting action to only one caller', async () => {
  const service=createModalService();
  const first=service.show({...request,dedupeKey:'setup'});
  const second=service.show({...request,dedupeKey:'setup'});
  service.resolve(service.getSnapshot()!.id,'primary');
  expect(await Promise.all([first,second])).toEqual(['primary','dismissed']);
  expect(service.getSnapshot()).toBeNull();
});
it('cancels a caller without dismissing another and settles every caller on disposal', async () => {
  const service=createModalService(); const controller=new AbortController();
  const first=service.show({...request,dedupeKey:'setup'},controller.signal);
  const second=service.show({...request,dedupeKey:'setup'});
  controller.abort();
  await expect(first).resolves.toBe('dismissed');
  expect(service.getSnapshot()).not.toBeNull();
  service.dismissAll(); await expect(second).resolves.toBe('dismissed');
  await expect(service.show(request,controller.signal)).resolves.toBe('dismissed');
});
