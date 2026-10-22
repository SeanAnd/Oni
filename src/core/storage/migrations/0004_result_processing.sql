CREATE TABLE result_processing (
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
