import { documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';

export const ARTIFACT_SUBDIRS = ['jobs', 'captures', 'exports', 'logs', 'attachments'] as const;

export type ArtifactSubdir = (typeof ARTIFACT_SUBDIRS)[number];

function requirePathSegment(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error('INVALID_PAYLOAD');
}

export function projectRootUri(root: string, projectId: string): string {
  requirePathSegment(projectId);
  return `${root.endsWith("/") ? root : `${root}/`}projects/${projectId}/`;
}

export function artifactDirectoryUri(root: string, projectId: string, subdir: ArtifactSubdir): string {
  if (!ARTIFACT_SUBDIRS.includes(subdir)) throw new Error("INVALID_PAYLOAD");
  return `${projectRootUri(root, projectId)}${subdir}/`;
}

export function artifactFileUri(
  root: string,
  projectId: string,
  subdir: ArtifactSubdir,
  fileName: string,
): string {
  requirePathSegment(fileName);
  return `${artifactDirectoryUri(root, projectId, subdir)}${fileName}`;
}

export async function ensureProjectArtifactLayout(root: string, projectId: string): Promise<void> {
  for (const subdir of ARTIFACT_SUBDIRS) {
    const dir = artifactDirectoryUri(root, projectId, subdir);
    await makeDirectoryAsync(dir, { intermediates: true });
  }
}

export function defaultDocumentDirectory(): string {
  if (!documentDirectory) throw new Error('CAPABILITY_UNAVAILABLE');
  return documentDirectory;
}
