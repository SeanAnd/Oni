import type { Observation } from '@/core/models/observation.model';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import { newEntityId, utcNowIso } from '@/core/storage/ids';

export interface HostViewModel {
  targetId: string;
  address: string;
  label: string;
  status?: string;
  lastObservedAt?: string;
}

export interface ServiceViewModel {
  targetId: string;
  address: string;
  port: number;
  protocol?: string;
  product?: string;
  version?: string;
  lastObservedAt?: string;
}

export class ObservationRepository {
  constructor(private readonly db: SqlDatabase) {}

  insertMany(projectId: string, jobId: string | undefined, observations: Observation[]): string[] {
    const ids: string[] = [];
    this.db.withTransaction(() => {
      for (const observation of observations) {
        const id = newEntityId('obs');
        const observedAt = observation.observedAt ?? utcNowIso();
        this.db.run(
          `INSERT INTO observations (id, project_id, job_id, type, source, target_id, data_json, observed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            projectId,
            jobId ?? observation.jobId ?? null,
            observation.type,
            observation.source,
            observation.targetId ?? null,
            JSON.stringify(observation.data ?? {}),
            observedAt,
          ],
        );
        ids.push(id);
      }
    });
    return ids;
  }

  listHosts(projectId: string): HostViewModel[] {
    const rows = this.db.getAll<{
      target_id: string | null;
      address: string;
      label: string;
      data_json: string;
      observed_at: string;
    }>(
      `SELECT o.target_id, o.data_json, o.observed_at, t.address, t.label
       FROM observations o
       LEFT JOIN targets t ON t.id = o.target_id AND t.project_id = o.project_id
       WHERE o.project_id = ? AND o.type = 'network.host'
       ORDER BY o.observed_at DESC`,
      [projectId],
    );
    return rows.map((row) => {
      const data = JSON.parse(row.data_json) as Record<string, unknown>;
      return {
        targetId: row.target_id ?? '',
        address: row.address || String(data.address ?? ''),
        label: row.label || String(data.label ?? ''),
        status: typeof data.status === 'string' ? data.status : undefined,
        lastObservedAt: row.observed_at,
      };
    });
  }

  listServices(projectId: string): ServiceViewModel[] {
    const rows = this.db.getAll<{
      target_id: string | null;
      address: string;
      data_json: string;
      observed_at: string;
    }>(
      `SELECT o.target_id, o.data_json, o.observed_at, t.address
       FROM observations o
       LEFT JOIN targets t ON t.id = o.target_id AND t.project_id = o.project_id
       WHERE o.project_id = ? AND o.type = 'network.service'
       ORDER BY o.observed_at DESC`,
      [projectId],
    );
    return rows.map((row) => {
      const data = JSON.parse(row.data_json) as Record<string, unknown>;
      return {
        targetId: row.target_id ?? '',
        address: row.address || String(data.address ?? ''),
        port: Number(data.port ?? 0),
        protocol: typeof data.protocol === 'string' ? data.protocol : undefined,
        product: typeof data.product === 'string' ? data.product : undefined,
        version: typeof data.version === 'string' ? data.version : undefined,
        lastObservedAt: row.observed_at,
      };
    });
  }

  countForProject(projectId: string): number {
    const row = this.db.getFirst<{ count: number }>(
      'SELECT COUNT(*) AS count FROM observations WHERE project_id = ?',
      [projectId],
    );
    return Number(row?.count ?? 0);
  }

  countForJob(projectId: string, jobId: string): number {
    const row = this.db.getFirst<{ count: number }>(
      'SELECT COUNT(*) AS count FROM observations WHERE project_id = ? AND job_id = ?',
      [projectId, jobId],
    );
    return Number(row?.count ?? 0);
  }
}
