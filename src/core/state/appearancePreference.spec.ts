import { readAppearance, writeAppearance } from './appearancePreference';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
beforeEach(() => { installTestAppStateDatabase(); });
afterEach(resetTestAppStateDatabase);
it('falls back from unknown saved IDs and persists the latest selection without a new schema', () => {
  const repo = new PreferencesRepository(openAppStateDatabase());
  repo.setString('appearance.theme', '__proto__'); expect(readAppearance(repo)).toBe('sumi');
  writeAppearance('ghost', repo); writeAppearance('edgerunners', repo); expect(readAppearance(repo)).toBe('edgerunners');
  expect(repo.getActiveProjectId()).toBeNull();
});
