import * as SQLite from 'expo-sqlite';

import type { SqlDatabase, SqlRunResult, SqlValue } from '@/core/storage/sqlDatabase.types';

export const APP_STATE_DB_NAME = 'skid_app_state.db';

export function createExpoSqlDatabase(name: string = APP_STATE_DB_NAME): SqlDatabase {
  const db = SQLite.openDatabaseSync(name);

  db.execSync('PRAGMA foreign_keys = ON');
  let transactionDepth = 0;

  return {
    exec(sql: string) {
      db.execSync(sql);
    },
    run(sql: string, params: readonly SqlValue[] = []): SqlRunResult {
      const result = db.runSync(sql, ...(params as SQLite.SQLiteBindValue[]));
      return {
        changes: result.changes,
        lastInsertRowId: result.lastInsertRowId,
      };
    },
    getFirst<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T | null {
      const row = db.getFirstSync<T>(sql, ...(params as SQLite.SQLiteBindValue[]));
      return row ?? null;
    },
    getAll<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T[] {
      return db.getAllSync<T>(sql, ...(params as SQLite.SQLiteBindValue[]));
    },
    withTransaction<T>(fn: () => T): T {
      const savepoint = `skid_transaction_${transactionDepth++}`;
      db.execSync(`SAVEPOINT ${savepoint}`);
      try {
        const value = fn();
        db.execSync(`RELEASE ${savepoint}`);
        return value;
      } catch (error) {
        db.execSync(`ROLLBACK TO ${savepoint}`);
        db.execSync(`RELEASE ${savepoint}`);
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
    close() {
      db.closeSync();
    },
  };
}
