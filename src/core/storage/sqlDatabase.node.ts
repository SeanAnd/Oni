import { DatabaseSync } from 'node:sqlite';

import type { SqlDatabase, SqlRunResult, SqlValue } from '@/core/storage/sqlDatabase.types';

export function createNodeSqlDatabase(path: string = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path);

  db.exec('PRAGMA foreign_keys = ON');
  let transactionDepth = 0;

  return {
    exec(sql: string) {
      db.exec(sql);
    },
    run(sql: string, params: readonly SqlValue[] = []): SqlRunResult {
      const result = db.prepare(sql).run(...params);
      return {
        changes: Number(result.changes),
        lastInsertRowId: Number(result.lastInsertRowid ?? 0),
      };
    },
    getFirst<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T | null {
      const row = db.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    getAll<T = Record<string, unknown>>(sql: string, params: readonly SqlValue[] = []): T[] {
      return db.prepare(sql).all(...params) as T[];
    },
    withTransaction<T>(fn: () => T): T {
      const savepoint = `skid_transaction_${transactionDepth++}`;
      db.exec(`SAVEPOINT ${savepoint}`);
      try {
        const value = fn();
        db.exec(`RELEASE ${savepoint}`);
        return value;
      } catch (error) {
        db.exec(`ROLLBACK TO ${savepoint}`);
        db.exec(`RELEASE ${savepoint}`);
        throw error;
      } finally {
        transactionDepth -= 1;
      }
    },
    close() {
      db.close();
    },
  };
}
