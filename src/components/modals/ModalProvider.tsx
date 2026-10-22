import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type PropsWithChildren, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle, type View } from 'react-native';
import { createModalService } from '@/core/state/modalService';
import type { ModalRequest } from '@/core/models/modal.model';
import { useSetupReadinessLifecycle } from '@/core/state/useSetupReadiness';
import { ThemedModal } from './ThemedModal';

const Context = createContext<ReturnType<typeof createModalService> | null>(null);
export function ModalProvider({children}: PropsWithChildren) {
  const [service] = useState(createModalService);
  const current = useSyncExternalStore(service.subscribe, service.getSnapshot);
  useSetupReadinessLifecycle();
  useEffect(() => () => service.dismissAll(), [service]);
  return <Context.Provider value={service}>{children}{current && <ThemedModal key={current.id} request={current.request} resolve={result => service.resolve(current.id, result)} />}</Context.Provider>;
}
export function useModalService(trigger?: RefObject<View | null>) {
  const service = useContext(Context);
  const callers = useRef(new Set<AbortController>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const pending = callers.current;
    return () => { alive.current = false; pending.forEach(caller => caller.abort()); pending.clear(); };
  }, []);
  return async (request: ModalRequest) => {
    if (!service || !alive.current) return 'dismissed' as const;
    const caller = new AbortController();
    callers.current.add(caller);
    const result = await service.show(request, caller.signal);
    callers.current.delete(caller);
    if (alive.current && trigger?.current) requestAnimationFrame(() => {
      const tag = trigger.current && findNodeHandle(trigger.current);
      if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
    });
    return alive.current ? result : 'dismissed' as const;
  };
}
