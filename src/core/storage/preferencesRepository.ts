import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';

export const ACTIVE_PROJECT_PREFERENCE_KEY = 'active_project_id';

export class PreferencesRepository {
  constructor(private readonly db: SqlDatabase) {}

  getString(key: string): string | null {
    const row = this.db.getFirst<{ value_json: string }>(
      'SELECT value_json FROM app_preferences WHERE key = ? LIMIT 1',
      [key],
    );
    if (!row) {
      return null;
    }
    try {
      const parsed = JSON.parse(row.value_json) as unknown;
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  setString(key: string, value: string): void {
    this.db.run('INSERT INTO app_preferences (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json', [
      key,
      JSON.stringify(value),
    ]);
  }

  getActiveProjectId(): string | null {
    return this.getString(ACTIVE_PROJECT_PREFERENCE_KEY);
  }

  setActiveProjectId(projectId: string): void {
    this.setString(ACTIVE_PROJECT_PREFERENCE_KEY, projectId);
  }
}
