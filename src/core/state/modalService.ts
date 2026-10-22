import type { ModalRequest, ModalResult } from '@/core/models/modal.model';

interface Caller { settle: (result: ModalResult) => void }
interface Entry { id: number; request: ModalRequest; callers: Set<Caller> }
/** Ephemeral and instance scoped. No navigation or execution callbacks are retained. */
export function createModalService(limit = 4) {
  let nextId = 0;
  const queue: Entry[] = [];
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  function resolve(id: number, result: ModalResult) {
    const index = queue.findIndex(entry => entry.id === id);
    if (index < 0) return;
    const [entry] = queue.splice(index, 1);
    // One caller owns an action; deduplicated callers settle without replaying it.
    let claimed = false;
    entry.callers.forEach(caller => { caller.settle(claimed ? 'dismissed' : result); claimed = true; });
    emit();
  }
  return {
    getSnapshot: () => queue[0] ?? null,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    show(request: ModalRequest, signal?: AbortSignal): Promise<ModalResult> {
      if (signal?.aborted) return Promise.resolve('dismissed');
      let entry = request.dedupeKey ? queue.find(item => item.request.dedupeKey === request.dedupeKey) : undefined;
      if (!entry) {
        if (queue.length >= limit) return Promise.resolve('dismissed');
        entry = {id: ++nextId, request: {...request}, callers: new Set()};
        queue.push(entry);
      }
      const target = entry;
      const promise = new Promise<ModalResult>(done => {
        const cancel = () => {
          target.callers.delete(caller);
          caller.settle('dismissed');
          if (!target.callers.size) resolve(target.id, 'dismissed');
        };
        const caller: Caller = { settle: result => { signal?.removeEventListener('abort', cancel); done(result); } };
        target.callers.add(caller);
        signal?.addEventListener('abort', cancel, {once: true});
      });
      emit();
      return promise;
    },
    resolve,
    dismissAll() { [...queue].forEach(entry => resolve(entry.id, 'dismissed')); },
  };
}
