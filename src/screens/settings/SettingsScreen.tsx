import { DatabaseMaintenance } from './DatabaseMaintenance';
import { FormInput as TextInput } from '@/components/FormInput';
import { Controller, useForm } from 'react-hook-form';
import { createDatabaseCredentialRepairFormValue, databaseCredentialRepairResolver, type DatabaseCredentialRepairFormValue } from '@/core/models/databaseCredentialRepair.model';
import { repairDeviceDatabasePassword } from '@/core/security/databaseCredentials';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { ActionButton } from '@/components/ActionButton';
import { readEnvironmentProfile } from '@/core/state/environmentProfile';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
import { backupManagedDatabase, latestManagedBackup, restoreManagedDatabase, latestManagedRollback, rollbackManagedDatabase, exportLatestManagedBackup } from '@/core/integrations/postgresql/databaseBackupService';
import { recoverWorkstationHelper, bootstrapWorkstation } from '@/core/integrations/termux/bootstrapService';
import type { WorkstationTheme } from '@/theme/tokens';
import { useThemedStyles } from '@/components/ThemeProvider';
import { AppearancePicker } from '@/components/AppearancePicker';
import { Screen, PageHeader, SectionTitle } from '@/components/Screen';

export function SettingsScreen() {
  const styles = useThemedStyles(createStyles);
  const router = useRouter();
  const repairForm = useForm<DatabaseCredentialRepairFormValue>({defaultValues: createDatabaseCredentialRepairFormValue(), resolver: databaseCredentialRepairResolver, mode: 'onChange'});
  const [profile, setProfile] = useState<EnvironmentProfileId>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [rollbackId, setRollbackId] = useState<string | null>(latestManagedRollback);
  const [backupId, setBackupId] = useState<string | null>(latestManagedBackup);
  useFocusEffect(useCallback(() => {
    let active = true;
    setProfile(undefined);
    void readEnvironmentProfile().then(next => { if (active) { setProfile(next); setBackupId(latestManagedBackup()); setRollbackId(latestManagedRollback()); } }).catch(() => { if (active) setMessage('Database profile could not be read. Reopen Settings to retry.'); });
    return () => { active = false; };
  }, []));
  async function backup() {
    setBusy(true);
    try {
      const result = await backupManagedDatabase();
      setBackupId(latestManagedBackup());
      setMessage(result.ok ? 'Private backup completed and hashed.' : result.detail ?? 'Backup failed. Inspect Jobs.');
    } finally { setBusy(false); }
  }
  async function restore(id: string) {
    setBusy(true);
    try {
      const result = await restoreManagedDatabase(id);
      setRollbackId(latestManagedRollback());
      setMessage(result.ok ? 'Restore completed. The previous database is retained for rollback. Verify Framework before continuing.' : result.detail ?? 'Restore failed. Inspect Jobs; the original database is retained.');
    } finally { setBusy(false); }
  }
  return <Screen><PageHeader title="Settings" />
    
    <SectionTitle>Appearance</SectionTitle><AppearancePicker /><SectionTitle>Setup and maintenance</SectionTitle><ActionButton label="Open Setup" variant="outline" onPress={() => router.push('/onboarding')} /><Text style={styles.body}>Database location: {!profile ? 'Loading…' : 'This device, in Termux'}</Text>
    <Text style={styles.body}>PostgreSQL runs privately on this Android device. Previous host databases have not been moved. Close Framework consoles before database recovery.</Text>
    <DatabaseMaintenance />
    <SectionTitle>Helper maintenance</SectionTitle><ActionButton label="Install or update helper" disabled={busy} onPress={() => {
      setBusy(true);
      void bootstrapWorkstation().then(result => setMessage(result.ok ? 'Verified helper installed.' : result.detail ?? 'Open Termux and install Python, then retry.')).finally(() => setBusy(false));
    }} />
    <ActionButton label="Recover helper" disabled={busy} onPress={() => {
      setBusy(true);
      void recoverWorkstationHelper().then(result => setMessage(result.ok ? 'Helper ready.' : result.detail ?? 'Open Termux and retry.')).finally(() => setBusy(false));
    }} />
    {profile === 'termux-local' ? <>
      <SectionTitle>Credential repair</SectionTitle><Text style={styles.body}>Recover the original device database credential (never rotates the database password).</Text>
      <Controller control={repairForm.control} name="password" render={({field: {value, onChange, onBlur}}) =>
        <TextInput accessibilityLabel="Original device database password" secureTextEntry autoCapitalize="none" autoCorrect={false} value={value} onChangeText={onChange} onBlur={onBlur} />
      } />
      {repairForm.formState.errors.password ? <Text style={styles.body}>Enter the original generated credential.</Text> : null}
      <ActionButton label="Repair saved credential" disabled={busy || !repairForm.formState.isValid} onPress={() => void repairForm.handleSubmit(async values => {
        setBusy(true);
        try {
          const repaired = await repairDeviceDatabasePassword(values.password);
          setMessage(repaired ? 'Original credential verified and saved.' : 'Credential rejected or database stopped. The saved credential was not changed.');
          if (repaired) repairForm.reset();
        } finally { setBusy(false); }
      })()} />
      <SectionTitle>Database backup and recovery</SectionTitle><ActionButton label="Back up database" disabled={busy} onPress={() => void backup()} />
      <ActionButton label="Export latest backup" disabled={busy || !backupId} onPress={() => {
        setBusy(true);
        void exportLatestManagedBackup().then(result => setMessage(result.detail)).catch(() => setMessage('Export failed. The private backup is retained.')).finally(() => setBusy(false));
      }} />
      <Text style={styles.body}>Latest private backup: {backupId ?? 'None'}</Text>
      <ActionButton label="Restore latest backup" disabled={busy || !backupId} onPress={() => {
        if (backupId) Alert.alert('Replace active database?', 'Close Framework sessions. The verified backup will be staged before replacement; the previous database is retained.', [{text: 'Cancel', style: 'cancel'}, {text: 'Restore', style: 'destructive', onPress: () => void restore(backupId)}]);
      }} />
      <ActionButton label="Roll back last restore" disabled={busy || !rollbackId} onPress={() => {
        if (rollbackId) Alert.alert('Restore the previous database?', 'Close Framework sessions. The database retained before the last restore will become active. The current database will also be retained.', [{text: 'Cancel', style: 'cancel'}, {text: 'Roll back', style: 'destructive', onPress: () => {
          setBusy(true);
          void rollbackManagedDatabase(rollbackId).then(result => {
            setRollbackId(latestManagedRollback());
            setMessage(result.ok ? 'Previous database restored. Verify Framework before continuing.' : result.detail ?? 'Rollback failed. Inspect Jobs.');
          }).finally(() => setBusy(false));
        }}]);
      }} />
    </> : null}
    <Text style={styles.body}>{message}</Text>
  </Screen>;
}
const createStyles = (theme: WorkstationTheme) => StyleSheet.create({
  content: {padding: theme.spacing.lg, gap: theme.spacing.md},
  title: {color: theme.colors.text, fontSize: theme.type.title},
  body: {color: theme.colors.text, fontSize: theme.type.body},
});
