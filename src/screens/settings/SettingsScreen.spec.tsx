import { render, screen, userEvent } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SettingsScreen } from './SettingsScreen';
import { restoreManagedDatabase } from '@/core/integrations/postgresql/databaseBackupService';
jest.mock('@/core/state/environmentProfile', () => ({readEnvironmentProfile: async () => 'termux-local', selectEnvironmentProfile: jest.fn()}));
jest.mock('@/core/integrations/postgresql/databaseBackupService', () => ({latestManagedBackup: () => 'test-backup', latestManagedRollback: () => null, restoreManagedDatabase: jest.fn(), backupManagedDatabase: jest.fn(), exportLatestManagedBackup: jest.fn()}));
it('preserves explicit restore confirmation and the profile-specific controls', async () => {
 const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
 await render(<SettingsScreen />);
 expect(await screen.findByText('Database location: This device, in Termux')).toBeOnTheScreen();
 await userEvent.press(screen.getByRole('button', {name: 'Restore latest backup'}));
 expect(alert).toHaveBeenCalledWith('Replace active database?', expect.any(String), expect.arrayContaining([expect.objectContaining({text: 'Cancel'}), expect.objectContaining({text: 'Restore', style: 'destructive'})]));
 expect(restoreManagedDatabase).not.toHaveBeenCalled();
 alert.mockRestore();
});
