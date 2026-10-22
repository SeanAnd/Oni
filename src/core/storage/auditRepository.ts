import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import { newEntityId, utcNowIso } from '@/core/storage/ids';

export class AuditRepository {
  constructor(private readonly db: SqlDatabase) {}

  append(projectId: string | null, action: string, detail: string): void {
    this.db.run('INSERT INTO audit_entries (id, project_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)', [
      newEntityId('audit'),
      projectId,
      action,
      detail,
      utcNowIso(),
    ]);
  }
}
