import { ResultProcessingRepository } from './resultProcessingRepository';
import type { Observation } from '@/core/models/observation.model';
import type { ArtifactRegistrationRequest } from '@/core/models/artifact.model';
import { isTerminalJobStatus } from '@/core/jobs/transitions';
import { getJobSummary, listJobSummaries, markJobResultIngested, reconcileJobs } from '@/core/jobs/jobClient';
import { TermuxHelperClient } from '@/core/integrations/termux/termuxHelperClient';
import { getTermuxHelperToken } from '@/core/security/termuxHelperToken';
import { downloadAndFinalizeArtifact } from '@/core/storage/artifactDownloader';
import {
  artifactFileUri,
  defaultDocumentDirectory,
  ensureProjectArtifactLayout,
  type ArtifactSubdir,
} from '@/core/storage/artifactPaths';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';
import { ArtifactRepository } from '@/core/storage/artifactRepository';
import { ObservationRepository } from '@/core/storage/observationRepository';
import { ProjectRepository } from '@/core/storage/projectRepository';
import { TargetRepository } from '@/core/storage/targetRepository';
import { AuditRepository } from '@/core/storage/auditRepository';

export function artifactIngestionMarker(artifactId: string): string {
  return `artifact:${artifactId}`;
}

export function observationsIngestionMarker(jobId: string): string {
  return `observations:${jobId}`;
}

export interface IngestArtifactRequest {
  projectId: string;
  jobId: string;
  artifactId: string;
  operationId: string;
  type: string;
  mimeType: string;
  subdir?: ArtifactSubdir;
  fileName?: string;
  source: string;
  expectedSize?: number;
  expectedHash?: string;
}

export interface IngestObservationsRequest {
  projectId: string;
  jobId: string;
  observations: Observation[];
}

export class JobResultIngestionService {
  private readonly helper = new TermuxHelperClient({ getAccessToken: getTermuxHelperToken });

  constructor(private readonly db: SqlDatabase) {}

  processing(): ResultProcessingRepository { return new ResultProcessingRepository(this.db); }

  private repos() {
    return {
      projects: new ProjectRepository(this.db),
      artifacts: new ArtifactRepository(this.db),
      observations: new ObservationRepository(this.db),
      audit: new AuditRepository(this.db),
    };
  }

  async ingestArtifact(request: IngestArtifactRequest): Promise<{ ok: boolean; errorKey?: string; detail?: string }> {
    const { projects, artifacts, audit } = this.repos();
    if (!(await projects.ownsProject(request.projectId))) {
      return { ok: false, errorKey: 'PROJECT_OWNERSHIP_DENIED' };
    }

    const job = await getJobSummary(request.jobId);
    if (!job || job.projectId !== request.projectId || job.operationId !== request.operationId || !job.artifactIds.includes(request.artifactId) || !isTerminalJobStatus(job.status)) {
      return { ok: false, errorKey: 'PROJECT_OWNERSHIP_DENIED' };
    }
    const marker = artifactIngestionMarker(request.artifactId);
    const existing = artifacts.getById(request.projectId, request.artifactId);
    if (existing) {
      if (existing.jobId !== request.jobId) return { ok: false, errorKey: 'PROJECT_OWNERSHIP_DENIED' };
      return this.acknowledge(request.jobId, marker);
    }

    const docRoot = defaultDocumentDirectory();
    await ensureProjectArtifactLayout(docRoot, request.projectId);
    const subdir = request.subdir ?? 'jobs';
    const fileName = request.fileName ?? `${request.artifactId}.bin`;
    const destinationUri = artifactFileUri(docRoot, request.projectId, subdir, fileName);

    const download = await downloadAndFinalizeArtifact({
      artifactId: request.artifactId,
      operationId: request.operationId,
      destinationUri,
      expectedSize: request.expectedSize,
      expectedHash: request.expectedHash,
      helper: this.helper,
    });

    if (!download.ok || !download.hash) {
      return {
        ok: false,
        errorKey: download.errorKey ?? 'JOB_FAILED',
        detail: download.detail,
      };
    }

    const registration: ArtifactRegistrationRequest = {
      id: request.artifactId,
      projectId: request.projectId,
      jobId: request.jobId,
      type: request.type,
      mimeType: request.mimeType,
      path: destinationUri,
      size: download.size,
      hash: download.hash,
      source: request.source,
    };

    this.db.withTransaction(() => {
      if (artifacts.getById(request.projectId, request.artifactId)) return;
      artifacts.register(registration);
      projects.touchUpdatedAt(request.projectId);
      audit.append(request.projectId, 'artifact.registered', request.artifactId);
    });

    return this.acknowledge(request.jobId, marker);
  }

  async ingestObservations(request: IngestObservationsRequest): Promise<{ ok: boolean; errorKey?: string }> {
    const { projects, observations, audit } = this.repos();
    if (!(await projects.ownsProject(request.projectId))) {
      return { ok: false, errorKey: 'PROJECT_OWNERSHIP_DENIED' };
    }

    const job = await getJobSummary(request.jobId);
    if (!job || job.projectId !== request.projectId || job.status !== 'completed') {
      return { ok: false, errorKey: 'PROJECT_OWNERSHIP_DENIED' };
    }
    const marker = observationsIngestionMarker(request.jobId);
    this.db.withTransaction(() => {
      const already = this.db.getFirst('SELECT 1 FROM result_ingestions WHERE project_id = ? AND job_id = ? AND marker = ?', [request.projectId, request.jobId, marker]);
      if (already) return;
      const targets = new TargetRepository(this.db);
      const projectTargets = targets.listByProject(request.projectId);
      const targetIds = new Set(projectTargets.map((target) => target.id));
      const targetsByAddress = new Map(projectTargets.map((target) => [target.address, target]));
      const normalized = request.observations.map((observation) => {
        if (observation.jobId && observation.jobId !== request.jobId) throw new Error('PROJECT_OWNERSHIP_DENIED');
        if (observation.targetId) {
          if (!targetIds.has(observation.targetId)) throw new Error('PROJECT_OWNERSHIP_DENIED');
          return observation;
        }
        const address = observation.data.address;
        if (typeof address !== 'string' || !address) return observation;
        const target = targetsByAddress.get(address) ?? targets.createTarget({projectId: request.projectId, address, label: address});
        targetsByAddress.set(address, target);
        targetIds.add(target.id);
        return { ...observation, targetId: target.id };
      });
      observations.insertMany(request.projectId, request.jobId, normalized);
      this.db.run('INSERT INTO result_ingestions (project_id, job_id, marker, created_at) VALUES (?, ?, ?, ?)', [request.projectId, request.jobId, marker, new Date().toISOString()]);
      projects.touchUpdatedAt(request.projectId);
      audit.append(request.projectId, 'observations.ingested', `${request.observations.length}`);
      this.db.run("UPDATE result_processing SET state = 'succeeded', error_key = NULL, detail = NULL, updated_at = ? WHERE project_id = ? AND job_id = ?", [new Date().toISOString(), request.projectId, request.jobId]);
    });

    return this.acknowledge(request.jobId, marker);
  }

  private async acknowledge(jobId: string, marker: string): Promise<{ok: boolean; errorKey?: string}> {
    return await markJobResultIngested(jobId, marker)
      ? {ok: true}
      : {ok: false, errorKey: 'JOB_FAILED'};
  }

  /** Count pending ingestion work; ProjectService owns feature-specific recovery. */
  async reconcileCompletedJobs(projectId?: string): Promise<number> {
    await reconcileJobs();
    const summaries = await listJobSummaries(projectId);
    let pending = 0;
    const { artifacts } = this.repos();
    for (const summary of summaries) {
      if (!isTerminalJobStatus(summary.status) || summary.status !== 'completed') {
        continue;
      }
      if (summary.observationsPending) {
        pending += 1;
      }
      if (summary.artifactIds.length > 0 && summary.operationId) {
        for (const artifactId of summary.artifactIds) {
          const registered = artifacts.getById(summary.projectId, artifactId);
          if (!registered) {
            pending += 1;
          }
        }
      }
    }
    return pending;
  }
}
