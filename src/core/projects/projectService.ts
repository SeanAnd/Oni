import { listJobSummaries, reconcileJobs } from '@/core/jobs/jobClient';
import { ingestCompletedNmapJob } from '@/core/integrations/nmap/nmapResultIngestion';
import type { ProjectOwnershipGate } from '@/core/capabilities/resolver';
import type { ProjectFormValue } from '@/core/models/projectForm.model';
import { toCreateProjectInput } from '@/core/models/projectForm.model';
import { validateProjectFormValue } from '@/core/validators/projectName.validators';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { AuditRepository } from '@/core/storage/auditRepository';
import { PreferencesRepository } from '@/core/storage/preferencesRepository';
import { ProjectRepository, type ProjectSummary } from '@/core/storage/projectRepository';
import { TargetRepository } from '@/core/storage/targetRepository';
import { ObservationRepository } from '@/core/storage/observationRepository';
import { ArtifactRepository } from '@/core/storage/artifactRepository';
import { JobResultIngestionService } from '@/core/storage/jobResultIngestion';
import type { SqlDatabase } from '@/core/storage/sqlDatabase.types';

export interface CreateProjectResult {
  ok: boolean;
  project?: ProjectSummary;
  fieldErrors?: Partial<Record<keyof ProjectFormValue, string>>;
  formError?: string;
}

export class ProjectService {
  private readonly db: SqlDatabase;

  constructor(db?: SqlDatabase) {
    this.db = db ?? openAppStateDatabase();
  }

  private projectRepo() {
    return new ProjectRepository(this.db);
  }

  async listProjectSummaries(): Promise<ProjectSummary[]> {
    return this.projectRepo().listSummaries();
  }

  async getActiveProjectId(): Promise<string | null> {
    return new PreferencesRepository(this.db).getActiveProjectId();
  }

  async setActiveProject(projectId: string): Promise<boolean> {
    const repo = this.projectRepo();
    if (!(await repo.ownsProject(projectId))) {
      return false;
    }
    new PreferencesRepository(this.db).setActiveProjectId(projectId);
    new AuditRepository(this.db).append(projectId, 'project.selected', projectId);
    return true;
  }

  async createProject(value: ProjectFormValue): Promise<CreateProjectResult> {
    const repo = this.projectRepo();
    const validation = validateProjectFormValue(value, {
      nameTaken: (name) => repo.findByName(name) !== null,
    });
    if (!validation.ok) {
      return {
        ok: false,
        fieldErrors: validation.fieldErrors,
        formError: validation.formError,
      };
    }

    const row = this.db.withTransaction(() => {
      const created = repo.createProject(toCreateProjectInput(value));
      new PreferencesRepository(this.db).setActiveProjectId(created.id);
      new AuditRepository(this.db).append(created.id, 'project.created', created.name);
      return created;
    });

    const summaries = repo.listSummaries();
    const project = summaries.find((item) => item.id === row.id);
    return { ok: true, project };
  }

  async getProjectDetail(projectId: string) {
    const repo = this.projectRepo();
    if (!(await repo.ownsProject(projectId))) {
      return null;
    }
    const project = repo.getById(projectId);
    if (!project) {
      return null;
    }
    return {
      project: repo.listSummaries().find((item) => item.id === projectId),
      targets: new TargetRepository(this.db).listByProject(projectId),
      hosts: new ObservationRepository(this.db).listHosts(projectId),
      services: new ObservationRepository(this.db).listServices(projectId),
      artifacts: new ArtifactRepository(this.db).listByProject(projectId),
    };
  }

  artifactById(projectId: string, artifactId: string) {
    return new ArtifactRepository(this.db).getById(projectId, artifactId);
  }

  ingestion(): JobResultIngestionService {
    return new JobResultIngestionService(this.db);
  }

  async reconcileOnResume(): Promise<number> {
    await reconcileJobs();
    let pending = 0;
    for (const job of await listJobSummaries(undefined, 500)) {
      if (job.type !== 'nmap.scan' || !['completed', 'failed', 'cancelled'].includes(job.status)) continue;
      if (!job.observationsPending && job.artifactIds.every((id) => this.artifactById(job.projectId, id))) continue;
      try {
        if (!(await ingestCompletedNmapJob(job, {projectService: this})).ok) pending++;
      } catch {
        // Leave this durable result pending without starving other projects.
        pending++;
      }
    }
    return pending;
  }
}

export function createProjectOwnershipGate(db?: SqlDatabase): ProjectOwnershipGate {
  const repository = new ProjectRepository(db ?? openAppStateDatabase());
  return {
    ownsProject: (projectId) => repository.ownsProject(projectId),
  };
}
