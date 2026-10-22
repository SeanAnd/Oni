import { useEffect } from 'react';
import { startWorkstationLifecycle } from '@/core/state/workstationLifecycle';

export function WorkstationLifecycle() {
  useEffect(() => startWorkstationLifecycle(), []);
  return null;
}
