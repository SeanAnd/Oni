import { runAppStateMigrations } from '@/core/storage/migrationRunner';
import { createNodeSqlDatabase } from '@/core/storage/sqlDatabase.node';
import { __setAppStateDatabaseForTests } from '@/core/storage/appStateDatabase';

export function installTestAppStateDatabase() {
  const db = createNodeSqlDatabase(':memory:');
  runAppStateMigrations(db);
  __setAppStateDatabaseForTests(db);
  return db;
}

export function resetTestAppStateDatabase() {
  __setAppStateDatabaseForTests(null);
}
