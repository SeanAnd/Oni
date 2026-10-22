import { useRef, useState } from 'react';
import { View } from 'react-native';
import { Body, SectionTitle } from '@/components/Screen';
import { ActionButton } from '@/components/ActionButton';
import { invokeDatabaseLifecycle } from '@/core/integrations/postgresql/databaseLifecycleService';
import { remediationForErrorKey } from '@/core/security/errorRemediation';

export function DatabaseMaintenance() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function run(operation: 'start' | 'stop') {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const result = await invokeDatabaseLifecycle(operation);
      setMessage(result.ok ? `Database ${operation} requested. Check Jobs for the outcome.` : remediationForErrorKey(result.errorKey, result.detail));
    } catch { setMessage('Database operation unavailable. Retry after recovering Termux.'); }
    finally { pending.current = false; setBusy(false); }
  }
  return <View style={{gap:8}}><SectionTitle>Database maintenance</SectionTitle><Body>Start or stop PostgreSQL on this device. Stopping it interrupts database-backed work.</Body>
    <ActionButton label="Start DB" disabled={busy} onPress={() => void run('start')} />
    <ActionButton label="Stop DB" disabled={busy} variant="outline" onPress={() => void run('stop')} />
    {message ? <Body>{message}</Body> : null}
  </View>;
}
