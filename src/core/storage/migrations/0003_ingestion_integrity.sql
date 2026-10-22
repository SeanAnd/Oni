CREATE TABLE result_ingestions (
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
