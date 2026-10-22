import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import { newEntityId, utcNowIso } from '@/core/storage/ids';

export interface TargetRow {
  id: string;
  project_id: string;
  label: string;
  address: string;
  kind: string;
  created_at: string;
}

export interface TargetRecord {
  id: string;
  projectId: string;
  label: string;
  address: string;
  kind: string;
  createdAt: string;
}

export interface CreateTargetInput {
  projectId: string;
  label: string;
  address: string;
  kind?: string;
}

function mapTarget(row: TargetRow): TargetRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    address: row.address,
    kind: row.kind,
    createdAt: row.created_at,
  };
}

export class TargetRepository {
  constructor(private readonly db: SqlDatabase) {}

  listByProject(projectId: string): TargetRecord[] {
    const rows = this.db.getAll<TargetRow>(
      'SELECT * FROM targets WHERE project_id = ? ORDER BY created_at ASC',
      [projectId],
    );
    return rows.map(mapTarget);
  }

  createTarget(input: CreateTargetInput): TargetRecord {
    const id = newEntityId('tgt');
    const now = utcNowIso();
    this.db.run(
      'INSERT INTO targets (id, project_id, label, address, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, input.projectId, input.label, input.address, input.kind ?? 'host', now],
    );
    const row = this.db.getFirst<TargetRow>('SELECT * FROM targets WHERE id = ?', [id]);
    if (!row) {
      throw new Error('TARGET_INSERT_FAILED');
    }
    return mapTarget(row);
  }
}
