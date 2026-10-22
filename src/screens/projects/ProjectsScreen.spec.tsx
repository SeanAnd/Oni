import { render, screen, userEvent } from '@testing-library/react-native';

import { ProjectsScreen } from '@/screens/projects/ProjectsScreen';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';

describe('ProjectsScreen', () => {
  beforeEach(() => {
    installTestAppStateDatabase();
  });

  afterEach(() => {
    resetTestAppStateDatabase();
  });

  it('creates a project through the form orchestration path', async () => {
    await render(<ProjectsScreen />);
    await userEvent.press(screen.getByRole('button', {name: '+ New project'}));
    await userEvent.type(screen.getByLabelText('Project name'), 'Lab Alpha');
    await userEvent.press(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Lab Alpha')).toBeTruthy();
    expect(screen.getByText('✓ Active project')).toBeTruthy();
  });
});

it('opens an empty draft after cancellation and validates reserved product names', async () => {
  installTestAppStateDatabase();
  await render(<ProjectsScreen />);
  await userEvent.press(screen.getByRole('button', {name:'+ New project'}));
  await userEvent.type(screen.getByLabelText('Project name'),'Oni');
  await userEvent.press(screen.getByRole('button',{name:'Create project'}));
  expect(screen.getByLabelText('Project name')).toBeOnTheScreen();
  expect(screen.queryByText('✓ Active project')).toBeNull();
  await userEvent.press(screen.getByRole('button',{name:'Cancel'}));
  await userEvent.press(screen.getByRole('button', {name:'+ New project'}));
  expect(screen.getByLabelText('Project name').props.value).toBe('');
  resetTestAppStateDatabase();
});
