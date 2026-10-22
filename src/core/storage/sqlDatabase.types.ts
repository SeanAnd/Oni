export type SqlValue = string | number | null;

export interface SqlRunResult {
  changes: number;
  lastInsertRowId: number;
}

export interface SqlDatabase {
  exec(sql: string): void;
  run(sql: string, params?: readonly SqlValue[]): SqlRunResult;
  getFirst<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T | null;
  getAll<T = Record<string, unknown>>(sql: string, params?: readonly SqlValue[]): T[];
  withTransaction<T>(fn: () => T): T;
  close(): void;
}
