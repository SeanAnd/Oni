import { useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';
import { useRouter } from 'expo-router';
import { checkSetupAccess } from '@/core/state/setupReadiness';
import { useModalService } from '../modals/ModalProvider';

export function useSetupGate(trigger?: RefObject<View | null>) {
  const show = useModalService(trigger);
  const router = useRouter();
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  return async () => {
    if (busy.current) return false;
    busy.current = true;
    try {
      let access = await checkSetupAccess();
      if (!alive.current) return false;
      if (access.allowed) return true;
      const unavailable = access.errorKey === 'SETUP_STATUS_UNAVAILABLE';
      const choice = await show(unavailable ? {
        dedupeKey:'setup-required', title:'Setup status unavailable', tone:'warning',
        body:'Oni could not read your saved setup status. Retry the check or open Setup. Your saved progress has not been cleared.',
        primaryLabel:'Retry', secondaryLabel:'Open Setup', dismissOnBackdrop:true,
      } : {
        dedupeKey:'setup-required', title:'Finish setting up Oni', tone:'warning',
        body:'Set up the tools on this phone before starting this action. Your saved setup progress will be kept. You can still browse projects and saved results.',
        primaryLabel:'Continue setup', secondaryLabel:'Not now', dismissOnBackdrop:true,
      });
      if (!alive.current) return false;
      if (unavailable && choice === 'primary') {
        access = await checkSetupAccess();
        // A retry checks status; it never silently replays the original action.
        if (!access.allowed && alive.current) router.push('/onboarding');
      } else if (choice === (unavailable ? 'secondary' : 'primary')) router.push('/onboarding');
      return false;
    } finally { busy.current = false; }
  };
}
