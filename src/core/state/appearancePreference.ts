import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { isThemeId, type ThemeId } from '@/theme/palettes';
const key = 'appearance.theme';
export function readAppearance(repository = new PreferencesRepository(openAppStateDatabase())): ThemeId {
  const value = repository.getString(key);
  return isThemeId(value) ? value : 'sumi';
}
export function writeAppearance(id: ThemeId, repository = new PreferencesRepository(openAppStateDatabase())): void {
  if (!isThemeId(id)) throw new Error('Invalid appearance');
  repository.setString(key, id);
}
