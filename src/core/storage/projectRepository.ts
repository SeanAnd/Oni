import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import { newEntityId, utcNowIso } from '@/core/storage/ids';

export interface ProjectRow {
  id: string;
  name: string;
  description: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  targetCount: number;
  observationCount: number;
  artifactCount: number;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  notes?: string;
}

function mapProject(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    notes: row.notes ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    targetCount: 0,
    observationCount: 0,
    artifactCount: 0,
  };
}

export class ProjectRepository {
  constructor(private readonly db: SqlDatabase) {}

  ensureSystemProject(): void {
    const id = 'system-onboarding';
    if (this.getById(id)) return;
    const now = utcNowIso();
    this.db.run('INSERT INTO projects (id, name, description, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, `System maintenance (${id})`, 'Device database backups and global maintenance.', '', now, now]);
  }

  async ownsProject(projectId: string): Promise<boolean> {
    const row = this.db.getFirst<{ id: string }>('SELECT id FROM projects WHERE id = ? LIMIT 1', [projectId]);
    return row !== null;
  }

  findByName(name: string): ProjectRow | null {
    return this.db.getFirst<ProjectRow>('SELECT * FROM projects WHERE name = ? COLLATE NOCASE LIMIT 1', [name]);
  }

  getById(projectId: string): ProjectRow | null {
    return this.db.getFirst<ProjectRow>('SELECT * FROM projects WHERE id = ? LIMIT 1', [projectId]);
  }

  listSummaries(): ProjectSummary[] {
    const rows = this.db.getAll<ProjectRow & { target_count: number; observation_count: number; artifact_count: number }>(
      `SELECT p.*,
        (SELECT COUNT(*) FROM targets t WHERE t.project_id = p.id) AS target_count,
        (SELECT COUNT(*) FROM observations o WHERE o.project_id = p.id) AS observation_count,
        (SELECT COUNT(*) FROM artifacts a WHERE a.project_id = p.id) AS artifact_count
      FROM projects p
      ORDER BY p.updated_at DESC`,
    );
    return rows.map((row) => ({
      ...mapProject(row),
      targetCount: Number(row.target_count),
      observationCount: Number(row.observation_count),
      artifactCount: Number(row.artifact_count),
    }));
  }

  createProject(input: CreateProjectInput): ProjectRow {
    const id = newEntityId('proj');
    const now = utcNowIso();
    this.db.run(
      'INSERT INTO projects (id, name, description, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, input.name, input.description, input.notes ?? '', now, now],
    );
    const created = this.getById(id);
    if (!created) {
      throw new Error('PROJECT_INSERT_FAILED');
    }
    return created;
  }

  touchUpdatedAt(projectId: string): void {
    this.db.run('UPDATE projects SET updated_at = ? WHERE id = ?', [utcNowIso(), projectId]);
  }
}
