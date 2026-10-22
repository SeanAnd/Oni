import { createHash } from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP_STATE_MIGRATIONS } from '@/core/storage/migrations/migrationDefinitions';
import { MigrationChecksumError, runAppStateMigrations } from '@/core/storage/migrationRunner';
import { createNodeSqlDatabase } from '@/core/storage/sqlDatabase.node';

describe('app-state migration runner', () => {
  it('applies a fresh database and records checksums', () => {
    const db = createNodeSqlDatabase(':memory:');
    const applied = runAppStateMigrations(db, { now: () => '2026-01-01T00:00:00.000Z' });
    expect(applied).toEqual(['0001_app_state_schema.sql', '0002_project_notes.sql', '0003_ingestion_integrity.sql', '0004_result_processing.sql']);

    const rows = db.getAll<{ filename: string; sha256: string }>(
      'SELECT filename, sha256 FROM app_migrations ORDER BY filename',
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]?.sha256).toBe(APP_STATE_MIGRATIONS[0]?.sha256);
  });

  it('upgrades when an earlier schema exists', () => {
    const db = createNodeSqlDatabase(':memory:');
    runAppStateMigrations(db, { migrations: [APP_STATE_MIGRATIONS[0]!] });
    db.run('INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      'proj_test',
      'Alpha',
      '',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    ]);

    const applied = runAppStateMigrations(db);
    expect(applied).toEqual(['0002_project_notes.sql', '0003_ingestion_integrity.sql', '0004_result_processing.sql']);
    const project = db.getFirst<{ notes: string }>('SELECT notes FROM projects WHERE id = ?', ['proj_test']);
    expect(project?.notes).toBe('');
  });

  it('rejects checksum drift for an applied migration', () => {
    const db = createNodeSqlDatabase(':memory:');
    runAppStateMigrations(db, { migrations: [APP_STATE_MIGRATIONS[0]!] });
    db.run('UPDATE app_migrations SET sha256 = ? WHERE filename = ?', ['0'.repeat(64), '0001_app_state_schema.sql']);

    expect(() => runAppStateMigrations(db, { migrations: [APP_STATE_MIGRATIONS[0]!] })).toThrow(MigrationChecksumError);
  });

  it('keeps numbered SQL files aligned with bundled definitions', () => {
    for (const migration of APP_STATE_MIGRATIONS) {
      const bytes = readFileSync(join(__dirname, 'migrations', migration.filename), 'utf8');
      const sha256 = createHash('sha256').update(bytes, 'utf8').digest('hex');
      expect(sha256).toBe(migration.sha256);
      expect(migration.sql).toBe(bytes);
    }
  });
});
