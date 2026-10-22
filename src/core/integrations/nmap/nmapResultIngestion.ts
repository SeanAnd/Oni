import { markJobResultIngested, getJobSummary } from '@/core/jobs/jobClient';
import { sha256FileUri } from '@/core/storage/artifactHash';
import { JobResultIngestionService } from '@/core/storage/jobResultIngestion';
import { ArtifactRepository } from '@/core/storage/artifactRepository';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { readAsStringAsync } from 'expo-file-system/legacy';

import type { JobSummary } from '@/core/models/job.model';
import type { Observation } from '@/core/models/observation.model';
import {
  observationsFromParseOutcome,
  parseNmapScanResult,
} from '@/core/integrations/nmap/nmapAdapter';
import type { NmapParseOutcome } from '@/core/integrations/nmap/nmapXmlParser';
import type { ProjectService } from '@/core/projects/projectService';

export interface NmapIngestionResult {
  ok: boolean;
  artifactIngested: boolean;
  observationsIngested: boolean;
  parseOutcome?: NmapParseOutcome;
  observations?: Observation[];
  errorKey?: string;
  detail?: string;
}

async function processNmapJob(
  summary: JobSummary,
  options?: {
    projectService?: ProjectService;
    targetId?: string;
    targetHint?: string;
  },
): Promise<NmapIngestionResult> {
  const service = options?.projectService;
  const ingestion = service?.ingestion() ?? new JobResultIngestionService(openAppStateDatabase());

  if (!['completed', 'failed', 'cancelled'].includes(summary.status)) {
    return {
      ok: false,
      artifactIngested: false,
      observationsIngested: false,
      errorKey: summary.errorKey ?? 'JOB_FAILED',
      detail: 'Job is not in a completed state.',
    };
  }

  const artifactId = summary.artifactIds[0];
  if (!artifactId || !summary.operationId) {
    return {
      ok: false,
      artifactIngested: false,
      observationsIngested: false,
      errorKey: 'INVALID_PAYLOAD',
      detail: 'Completed Nmap job is missing artifact or operation identifiers.',
    };
  }

  const artifactIngest = await ingestion.ingestArtifact({
    projectId: summary.projectId,
    jobId: summary.id,
    artifactId,
    operationId: summary.operationId,
    type: 'nmap.xml',
    mimeType: 'application/xml',
    subdir: 'jobs',
    fileName: `${artifactId}.xml`,
    source: 'nmap',
  });

  if (!artifactIngest.ok) {
    return {
      ok: false,
      artifactIngested: false,
      observationsIngested: false,
      errorKey: artifactIngest.errorKey,
      detail: artifactIngest.detail,
    };
  }

  const artifactRow = service ? service.artifactById(summary.projectId, artifactId) : new ArtifactRepository(openAppStateDatabase()).getById(summary.projectId, artifactId);
  if (!artifactRow) {
    return {
      ok: false,
      artifactIngested: true,
      observationsIngested: false,
      errorKey: 'PARSER_FAILED',
      detail: 'Artifact metadata missing after ingest.',
    };
  }

  if (summary.status !== 'completed') return { ok: true, artifactIngested: true, observationsIngested: false };

  let xml = '';
  try {
    xml = await readAsStringAsync(artifactRow.path);
  } catch (error) {
    return {
      ok: false,
      artifactIngested: true,
      observationsIngested: false,
      errorKey: 'PARSER_FAILED',
      detail: error instanceof Error ? error.message : 'Unable to read artifact bytes.',
    };
  }

  if (await sha256FileUri(artifactRow.path) !== artifactRow.hash) return {ok: false, artifactIngested: true, observationsIngested: false, errorKey: 'ARTIFACT_INTEGRITY_FAILED'};

  const parseOutcome = parseNmapScanResult(xml, {
    jobId: summary.id,
    targetHint: options?.targetHint,
  });

  if (parseOutcome.status === 'parser_failed' || parseOutcome.status === 'truncated') {
    return {
      ok: false,
      artifactIngested: true,
      observationsIngested: false,
      parseOutcome,
      errorKey: 'PARSER_FAILED',
      detail: parseOutcome.detail,
    };
  }

  const observations = observationsFromParseOutcome(parseOutcome, {
    jobId: summary.id,
    targetId: options?.targetId,
  });

  const observationIngest = await ingestion.ingestObservations({
    projectId: summary.projectId,
    jobId: summary.id,
    observations,
  });

  if (!observationIngest.ok) {
    return {
      ok: false,
      artifactIngested: true,
      observationsIngested: false,
      parseOutcome,
      errorKey: observationIngest.errorKey,
    };
  }

  return {
    ok: true,
    artifactIngested: true,
    observationsIngested: true,
    parseOutcome,
    observations,
  };
}

const inFlight = new Map<string, Promise<NmapIngestionResult>>();

/** One parser attempt per job; permanent failures survive JS/native acknowledgement gaps. */
export function ingestCompletedNmapJob(summary: JobSummary, options?: Parameters<typeof processNmapJob>[1] & {retry?: boolean}): Promise<NmapIngestionResult> {
  const key = `${summary.projectId}:${summary.id}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const work = (async () => {
    const actual = await getJobSummary(summary.id);
    if (!actual || actual.projectId !== summary.projectId || actual.operationId !== summary.operationId) return {ok: false, artifactIngested: false, observationsIngested: false, errorKey: 'PROJECT_OWNERSHIP_DENIED'};
    const service = options?.projectService;
    const ingestion = service?.ingestion() ?? new JobResultIngestionService(openAppStateDatabase());
    const processing = ingestion.processing();
    const previous = processing.get(summary.projectId, summary.id);
    if (summary.status === 'completed' && previous?.state === 'succeeded') {
      const acknowledged = await markJobResultIngested(summary.id, `observations:${summary.id}`);
      return {ok: acknowledged, artifactIngested: true, observationsIngested: true, errorKey: acknowledged ? undefined : 'JOB_FAILED'};
    }
    if (summary.status === 'completed' && previous?.state === 'failed' && !options?.retry && (previous.errorKey === 'PARSER_FAILED' || previous.errorKey === 'ARTIFACT_INTEGRITY_FAILED' || previous.attemptCount >= 3)) {
      return {ok: false, artifactIngested: !!previous.artifactHash, observationsIngested: false, errorKey: previous.errorKey, detail: previous.detail};
    }
    if (summary.status === 'completed') processing.begin(summary.projectId, summary.id);
    let result: NmapIngestionResult;
    try { result = await processNmapJob(summary, options); }
    catch { result = {ok: false, artifactIngested: false, observationsIngested: false, errorKey: 'JOB_FAILED'}; }
    if (summary.status === 'completed') {
      const id = summary.artifactIds[0];
      const artifact = id ? (service ? service.artifactById(summary.projectId, id) : new ArtifactRepository(openAppStateDatabase()).getById(summary.projectId, id)) : null;
      const committed = processing.get(summary.projectId, summary.id)?.state === 'succeeded';
      processing.finish(summary.projectId, summary.id, {...result, ok: committed || result.ok, errorKey: committed ? undefined : result.errorKey, artifactId: id, artifactHash: artifact?.hash});
    }
    return result;
  })();
  inFlight.set(key, work);
  void work.finally(() => inFlight.delete(key)).catch(() => undefined);
  return work;
}
