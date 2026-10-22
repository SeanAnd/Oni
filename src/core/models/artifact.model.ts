export const ARTIFACT_TYPES = [
  'nmap.xml',
  'tool.stdout',
  'tool.stderr',
  'capture.pcap',
  'log.text',
  'export.bundle',
  'raw.output',
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export interface Artifact {
  id: string;
  projectId: string;
  jobId?: string;
  type: ArtifactType | string;
  mimeType: string;
  path: string;
  size: number;
  hash: string;
  createdAt: string;
  source: string;
}

export interface ArtifactRegistrationRequest {
  id: string;
  projectId: string;
  jobId?: string;
  type: string;
  mimeType: string;
  path: string;
  size: number;
  hash: string;
  source: string;
}
