import type { SqlDatabase } from './sqlDatabase.types';

export interface ResultProcessingSummary {
  state: 'pending' | 'running' | 'succeeded' | 'failed';
  errorKey?: string;
  detail?: string;
  attemptCount: number;
  artifactId?: string;
  artifactHash?: string;
  updatedAt: string;
}

export class ResultProcessingRepository {
  constructor(private readonly db: SqlDatabase) {}
  get(projectId: string, jobId: string): ResultProcessingSummary | null {
    return this.db.getFirst<ResultProcessingSummary>('SELECT state, error_key AS errorKey, detail, attempt_count AS attemptCount, artifact_id AS artifactId, artifact_hash AS artifactHash, updated_at AS updatedAt FROM result_processing WHERE project_id = ? AND job_id = ?', [projectId, jobId]);
  }
  begin(projectId: string, jobId: string): void {
    this.db.run("INSERT INTO result_processing (project_id, job_id, state, attempt_count, updated_at) VALUES (?, ?, 'running', 1, ?) ON CONFLICT(project_id, job_id) DO UPDATE SET state = 'running', error_key = NULL, detail = NULL, attempt_count = attempt_count + 1, updated_at = excluded.updated_at", [projectId, jobId, new Date().toISOString()]);
  }
  finish(projectId: string, jobId: string, result: {ok: boolean; errorKey?: string; artifactId?: string; artifactHash?: string}): void {
    const detail = result.ok ? null : result.errorKey === 'PARSER_FAILED' ? 'Raw XML could not be parsed. Retrying the same bytes may still fail; start a separate scan if the XML is truncated.' : result.errorKey === 'ARTIFACT_INTEGRITY_FAILED' ? 'Artifact bytes do not match the retained hash.' : 'Result transfer or acknowledgement failed. Recover services before retrying.';
    this.db.run('UPDATE result_processing SET state = ?, error_key = ?, detail = ?, artifact_id = ?, artifact_hash = ?, updated_at = ? WHERE project_id = ? AND job_id = ?', [result.ok ? 'succeeded' : 'failed', result.errorKey ?? null, detail, result.artifactId ?? null, result.artifactHash ?? null, new Date().toISOString(), projectId, jobId]);
  }
}
