import type { AppStateMigration } from '@/core/storage/migrations/manifest';
import { APP_STATE_MIGRATIONS } from '@/core/storage/migrations/manifest';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';

export class MigrationChecksumError extends Error {
  constructor(
    message: string,
    readonly filename: string,
  ) {
    super(message);
    this.name = 'MigrationChecksumError';
  }
}

interface AppliedMigrationRow {
  filename: string;
  sha256: string;
}

function readApplied(db: SqlDatabase): Map<string, string> {
  const rows = db.getAll<AppliedMigrationRow>('SELECT filename, sha256 FROM app_migrations ORDER BY filename');
  return new Map(rows.map((row) => [row.filename, row.sha256]));
}

function recordMigration(db: SqlDatabase, migration: AppStateMigration, appliedAt: string): void {
  db.run('INSERT INTO app_migrations (filename, sha256, applied_at) VALUES (?, ?, ?)', [
    migration.filename,
    migration.sha256,
    appliedAt,
  ]);
}

export interface RunMigrationsOptions {
  migrations?: readonly AppStateMigration[];
  now?: () => string;
}

/** Apply pending migrations; reject checksum drift on already-applied files. */
export function runAppStateMigrations(db: SqlDatabase, options: RunMigrationsOptions = {}): string[] {
  const migrations = options.migrations ?? APP_STATE_MIGRATIONS;
  const now = options.now ?? (() => new Date().toISOString());
  const applied: string[] = [];

  const hasMigrationsTable = db.getFirst<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_migrations'",
  );

  const appliedRows = hasMigrationsTable ? readApplied(db) : new Map<string, string>();

  const known = new Set(migrations.map((migration) => migration.filename));
  for (const [filename, checksum] of appliedRows) {
    if (!known.has(filename) || migrations.find((m) => m.filename === filename)?.sha256 !== checksum) {
      throw new MigrationChecksumError('Applied migration is unknown or changed.', filename);
    }
  }
  for (const migration of migrations) {
    const existingChecksum = appliedRows.get(migration.filename);
    if (existingChecksum !== undefined) {
      if (existingChecksum !== migration.sha256) {
        throw new MigrationChecksumError(
          `Migration checksum mismatch for ${migration.filename}. Restore the applied bytes or append a new numbered migration.`,
          migration.filename,
        );
      }
      continue;
    }

    db.withTransaction(() => {
      db.exec(migration.sql);
      recordMigration(db, migration, now());
    });
    applied.push(migration.filename);
    appliedRows.set(migration.filename, migration.sha256);
  }

  return applied;
}
