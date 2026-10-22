export interface AppStateMigration {
  filename: string;
  sql: string;
  sha256: string;
}

function defineMigration(filename: string, sql: string, sha256: string): AppStateMigration {
  return {
    filename,
    sql,
    sha256,
  };
}

const M0001 = `CREATE TABLE IF NOT EXISTS app_migrations (
  filename TEXT PRIMARY KEY NOT NULL,
  sha256 TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name ON projects(name);

CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'host',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_targets_project ON targets(project_id);

CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT,
  type TEXT NOT NULL,
  source TEXT NOT NULL,
  target_id TEXT,
  data_json TEXT NOT NULL DEFAULT '{}',
  observed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project_id);
CREATE INDEX IF NOT EXISTS idx_observations_job ON observations(job_id);
CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(project_id, type);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT,
  type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artifacts_path ON artifacts(project_id, path);
CREATE INDEX IF NOT EXISTS idx_artifacts_job ON artifacts(job_id);

CREATE TABLE IF NOT EXISTS app_preferences (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_entries(project_id);
`;

const M0002 = `ALTER TABLE projects ADD COLUMN notes TEXT NOT NULL DEFAULT '';
`;

const M0003 = `CREATE TABLE result_ingestions (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  marker TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, job_id, marker)
);
CREATE INDEX idx_targets_project_address ON targets(project_id, address);
CREATE INDEX idx_artifacts_project_job ON artifacts(project_id, job_id);
CREATE INDEX idx_observations_project_job ON observations(project_id, job_id);
CREATE TRIGGER observations_target_project_insert
BEFORE INSERT ON observations WHEN NEW.target_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_OWNERSHIP_DENIED') WHERE NOT EXISTS (
    SELECT 1 FROM targets WHERE id = NEW.target_id AND project_id = NEW.project_id
  );
END;
CREATE TRIGGER observations_target_project_update
BEFORE UPDATE OF target_id, project_id ON observations WHEN NEW.target_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'PROJECT_OWNERSHIP_DENIED') WHERE NOT EXISTS (
    SELECT 1 FROM targets WHERE id = NEW.target_id AND project_id = NEW.project_id
  );
END;
CREATE TRIGGER artifacts_metadata_insert
BEFORE INSERT ON artifacts
BEGIN
  SELECT RAISE(ABORT, 'INVALID_ARTIFACT')
  WHERE NEW.size < 0 OR length(NEW.hash) != 64 OR NEW.hash GLOB '*[^0-9a-f]*';
END;
`;

const M0004 = `CREATE TABLE result_processing (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed')),
  error_key TEXT,
  detail TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  artifact_id TEXT,
  artifact_hash TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, job_id)
);
`;

/** Runtime migration list (Metro-safe). Keep .sql siblings in sync for review. */
export const APP_STATE_MIGRATIONS: readonly AppStateMigration[] = [
  defineMigration(
    '0001_app_state_schema.sql',
    M0001,
    '5b80789e72efc7d8b2d56cbf7a52178ae1bebc23e56f80eb5df22f3327cd22ae',
  ),
  defineMigration(
    '0002_project_notes.sql',
    M0002,
    '92933aabcbf6f6a7992b7fdfd24044b126c01a7f8169391f6b04496147e58cae',
  ),
  defineMigration("0003_ingestion_integrity.sql", M0003, "4117a15ae3b3c3bc89c47686fb189e71a105278cb429e53c32704a573d64a2bb"),
  defineMigration("0004_result_processing.sql", M0004, "1b14daa996aad30a7458835b11eb276058fb5fe2851686785a6d917f9a3d3f0f"),
];
