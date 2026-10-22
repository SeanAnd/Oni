import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      revision++;
      if (active) setReduced(value);
    });
    const requested = revision;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (active && requested === revision) setReduced(value);
    }).catch(() => {});
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}
