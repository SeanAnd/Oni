import { runAppStateMigrations } from '@/core/storage/migrationRunner';
import { createExpoSqlDatabase, APP_STATE_DB_NAME } from '@/core/storage/sqlDatabase.expo';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';

let cachedDb: SqlDatabase | null = null;

export function openAppStateDatabase(options?: { db?: SqlDatabase }): SqlDatabase {
  if (options?.db) {
    runAppStateMigrations(options.db);
    return options.db;
  }
  if (!cachedDb) {
    const candidate = createExpoSqlDatabase(APP_STATE_DB_NAME);
    try { runAppStateMigrations(candidate); } catch (error) { candidate.close(); throw error; }
    cachedDb = candidate;
  }
  return cachedDb;
}

/** Test hook: reset singleton and inject an in-memory database. */
export function __resetAppStateDatabaseForTests(): void {
  cachedDb?.close();
  cachedDb = null;
}

export function __setAppStateDatabaseForTests(db: SqlDatabase | null): void {
  cachedDb?.close();
  cachedDb = db;
}
