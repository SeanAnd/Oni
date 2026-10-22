import { render, screen, userEvent } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { ThemeProvider } from './ThemeProvider';
import { AppearancePicker } from './AppearancePicker';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
import { readAppearance } from '@/core/state/appearancePreference';
beforeEach(() => { installTestAppStateDatabase(); });
afterEach(resetTestAppStateDatabase);
it('changes and persists appearance without remounting a form', async () => {
  await render(<ThemeProvider><TextInput accessibilityLabel="Draft" /><AppearancePicker /></ThemeProvider>);
  await userEvent.type(screen.getByLabelText('Draft'), 'still here');
  for (const name of ['Catppuccin Mocha', 'Street Ink', 'Edgerunners', 'Ghost', 'Sumi Ink']) {
    await userEvent.press(screen.getByRole('radio', { name }));
    expect(screen.getByRole('radio', { name }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByDisplayValue('still here')).toBeOnTheScreen();
  }
  expect(readAppearance()).toBe('sumi');
});
