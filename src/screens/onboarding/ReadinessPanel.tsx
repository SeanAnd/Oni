import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { Body, SectionTitle } from '@/components/Screen';
import { StatusRow } from '@/components/StatusRow';
import { refreshEnvironmentSample } from '@/core/integrations/system/environmentSnapshot';
import type { SystemStatusSnapshot } from '@/core/integrations/system/systemStatusService';
import { enqueueKaliHealthJob } from '@/core/jobs/jobClient';
import { newEntityId } from '@/core/storage/ids';
import { SYSTEM_PROJECT_ID } from '@/core/models/systemScope.model';

export function ReadinessPanel() {
  const [snapshot, setSnapshot] = useState<SystemStatusSnapshot>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function check(kali = false) {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      if (kali) {
        const result = await enqueueKaliHealthJob({id:newEntityId('kali-health'),projectId:SYSTEM_PROJECT_ID});
        if (alive.current) setMessage(result.ok ? 'Kali health check queued. Open Jobs for results.' : result.detail ?? 'Kali check unavailable.');
      }
      const result = await refreshEnvironmentSample(true);
      if (alive.current) setSnapshot(result.snapshot);
    } catch { if (alive.current) setMessage('Readiness check unavailable. Retry after recovering Termux in Settings.'); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  return <View style={{gap:8}}><SectionTitle>Current readiness</SectionTitle><Body>Check current services without reinstalling anything or changing your saved setup history.</Body>
    <ActionButton label={busy ? 'Checking readiness…' : 'Recheck readiness'} disabled={busy} onPress={() => void check()} />
    <ActionButton label="Test Kali" disabled={busy} variant="outline" onPress={() => void check(true)} />
    {snapshot && [snapshot.termux,snapshot.kali,snapshot.database,snapshot.metasploit].map(status => <StatusRow key={status.label} {...status} />)}
    {message ? <Body>{message}</Body> : null}
  </View>;
}
