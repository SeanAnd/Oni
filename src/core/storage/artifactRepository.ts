import type { Artifact, ArtifactRegistrationRequest } from '@/core/models/artifact.model';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import { utcNowIso } from '@/core/storage/ids';

function mapArtifact(row: {
  id: string;
  project_id: string;
  job_id: string | null;
  type: string;
  mime_type: string;
  path: string;
  size: number;
  hash: string;
  created_at: string;
  source: string;
}): Artifact {
  return {
    id: row.id,
    projectId: row.project_id,
    jobId: row.job_id ?? undefined,
    type: row.type,
    mimeType: row.mime_type,
    path: row.path,
    size: row.size,
    hash: row.hash,
    createdAt: row.created_at,
    source: row.source,
  };
}

export class ArtifactRepository {
  constructor(private readonly db: SqlDatabase) {}

  getById(projectId: string, artifactId: string): Artifact | null {
    const row = this.db.getFirst<{
      id: string;
      project_id: string;
      job_id: string | null;
      type: string;
      mime_type: string;
      path: string;
      size: number;
      hash: string;
      created_at: string;
      source: string;
    }>('SELECT * FROM artifacts WHERE project_id = ? AND id = ? LIMIT 1', [projectId, artifactId]);
    return row ? mapArtifact(row) : null;
  }

  listByProject(projectId: string): Artifact[] {
    const rows = this.db.getAll<{
      id: string;
      project_id: string;
      job_id: string | null;
      type: string;
      mime_type: string;
      path: string;
      size: number;
      hash: string;
      created_at: string;
      source: string;
    }>('SELECT * FROM artifacts WHERE project_id = ? ORDER BY created_at DESC', [projectId]);
    return rows.map(mapArtifact);
  }

  listByJob(projectId: string, jobId: string): Artifact[] {
    const rows = this.db.getAll<{
      id: string;
      project_id: string;
      job_id: string | null;
      type: string;
      mime_type: string;
      path: string;
      size: number;
      hash: string;
      created_at: string;
      source: string;
    }>('SELECT * FROM artifacts WHERE project_id = ? AND job_id = ? ORDER BY created_at ASC', [
      projectId,
      jobId,
    ]);
    return rows.map(mapArtifact);
  }

  register(request: ArtifactRegistrationRequest): Artifact {
    const createdAt = utcNowIso();
    this.db.run(
      `INSERT INTO artifacts (id, project_id, job_id, type, mime_type, path, size, hash, created_at, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        request.id,
        request.projectId,
        request.jobId ?? null,
        request.type,
        request.mimeType,
        request.path,
        request.size,
        request.hash,
        createdAt,
        request.source,
      ],
    );
    const artifact = this.getById(request.projectId, request.id);
    if (!artifact) {
      throw new Error('ARTIFACT_INSERT_FAILED');
    }
    return artifact;
  }
}
