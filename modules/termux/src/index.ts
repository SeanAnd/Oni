import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
import type { DatabaseLifecycleRequest, DatabaseLifecycleResponse } from '@/core/models/databaseContracts.model';
import { requireNativeModule } from 'expo-modules-core';

import type { SkidErrorKey } from '@/core/security/errorKeys';

export interface TermuxStatus {
  installed: boolean;
  permissionGranted: boolean;
  errorKey?: SkidErrorKey;
  detail?: string;
}

export interface KaliHealthResult {
  ok: boolean;
  arch?: string;
  kaliRelease?: string;
  nhPath?: string;
  helperVersion?: string;
  errorKey?: SkidErrorKey;
  detail?: string;
}

export interface StructuredJobNativeOptions {
  jobId: string;
  projectId: string;
  timeoutMs?: number;
  command: {
    binary: string;
    args: string[];
    cwd?: string;
  };
}

export interface StructuredJobNativeResult {
  jobId: string;
  ok: boolean;
  exitCode?: number | null;
  artifactIds: string[];
  observationsPending: boolean;
  errorKey?: SkidErrorKey;
  detail?: string;
}

export interface HelperCallResult {
  ok: boolean;
  errorKey?: SkidErrorKey;
  detail?: string;
  payload?: string;
}

export interface BootstrapInstallInfo {
  command: string;
  manifestVersion: string;
  workstationHome: string;
}

export interface MetasploitScriptResult {
  ok: boolean;
  errorKey?: SkidErrorKey;
  detail?: string;
  connected?: boolean;
  schemaReady?: boolean;
  launchAcknowledged?: boolean;
  configured?: boolean;
}

export interface MetasploitDatabaseConfigRequest {
  jobId: string;
  profileId?: EnvironmentProfileId;
  host?: string;
  port?: number;
  username?: string;
  database?: string;
  password: string;
}

type SkidTermuxModule = {
  probeSetup(): Promise<string>;
  probeKaliSetup(): Promise<string>;
  openTermux(): Promise<boolean>;
  checkProfileSwitch(): Promise<MetasploitScriptResult>;
  databaseOperation(requestJson: string): Promise<{payload?: string; ok: boolean; errorKey?: SkidErrorKey; detail?: string}>;
  prepareDatabaseCredential(requestJson: string): Promise<MetasploitScriptResult>;
  installWorkstationBundle(helperToken: string): Promise<MetasploitScriptResult>;
  startWorkstationHelper(helperToken: string): Promise<MetasploitScriptResult>;
  getTermuxStatus(): Promise<TermuxStatus>;
  openTermuxAppSettings(): Promise<boolean>;
  runKaliHealth(timeoutMs?: number): Promise<KaliHealthResult>;
  runStructuredJob(options: StructuredJobNativeOptions): Promise<StructuredJobNativeResult>;
  getHelperJobStatus(jobId: string, operationId: string, helperToken: string): Promise<HelperCallResult>;
  cancelHelperJob(jobId: string, operationId: string, helperToken: string): Promise<HelperCallResult>;
  readHelperArtifactChunk(
    artifactId: string,
    offset: number,
    limit: number,
    operationId: string,
    helperToken: string,
  ): Promise<HelperCallResult>;
  getBootstrapInstallCommand(): Promise<BootstrapInstallInfo>;
  configureMetasploitDatabase(requestJson: string): Promise<MetasploitScriptResult>;
  verifyMetasploitDatabase(profileId: string): Promise<MetasploitScriptResult>;
  launchMetasploitConsole(profileId: string): Promise<MetasploitScriptResult>;
};

let nativeModule: SkidTermuxModule | null | undefined;

function getModule(): SkidTermuxModule | null {
  if (nativeModule !== undefined) {
    return nativeModule;
  }
  try {
    nativeModule = requireNativeModule<SkidTermuxModule>('SkidTermux');
  } catch {
    nativeModule = null;
  }
  return nativeModule;
}

const unavailableStatus: TermuxStatus = {
  installed: false,
  permissionGranted: false,
  errorKey: 'CAPABILITY_UNAVAILABLE',
  detail: 'SkidTermux native module is not loaded (development build required).',
};

export async function getTermuxStatus(): Promise<TermuxStatus> {
  const module = getModule();
  if (!module) {
    return unavailableStatus;
  }
  return module.getTermuxStatus();
}

export async function openTermuxAppSettings(): Promise<boolean> {
  const module = getModule();
  if (!module) {
    return false;
  }
  return module.openTermuxAppSettings();
}

export async function runKaliHealth(timeoutMs = 120_000): Promise<KaliHealthResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.runKaliHealth(timeoutMs);
}

export async function runStructuredJob(options: StructuredJobNativeOptions): Promise<StructuredJobNativeResult> {
  const module = getModule();
  if (!module) {
    return {
      jobId: options.jobId,
      ok: false,
      exitCode: null,
      artifactIds: [],
      observationsPending: false,
      errorKey: 'CAPABILITY_UNAVAILABLE',
      detail: unavailableStatus.detail,
    };
  }
  return module.runStructuredJob(options);
}

export async function getHelperJobStatus(
  jobId: string,
  operationId: string,
  helperToken: string,
): Promise<HelperCallResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.getHelperJobStatus(jobId, operationId, helperToken);
}

export async function cancelHelperJob(
  jobId: string,
  operationId: string,
  helperToken: string,
): Promise<HelperCallResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.cancelHelperJob(jobId, operationId, helperToken);
}

export async function readHelperArtifactChunk(
  artifactId: string,
  offset: number,
  limit: number,
  operationId: string,
  helperToken: string,
): Promise<HelperCallResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.readHelperArtifactChunk(artifactId, offset, limit, operationId, helperToken);
}

export async function configureMetasploitDatabase(
  request: MetasploitDatabaseConfigRequest,
): Promise<MetasploitScriptResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.configureMetasploitDatabase(JSON.stringify(request));
}

export async function verifyMetasploitDatabase(profileId: EnvironmentProfileId = 'termux-local'): Promise<MetasploitScriptResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.verifyMetasploitDatabase(profileId);
}

export async function launchMetasploitConsole(profileId: EnvironmentProfileId = 'termux-local'): Promise<MetasploitScriptResult> {
  const module = getModule();
  if (!module) {
    return { ok: false, errorKey: 'CAPABILITY_UNAVAILABLE', detail: unavailableStatus.detail };
  }
  return module.launchMetasploitConsole(profileId);
}

export async function getBootstrapInstallCommand(): Promise<BootstrapInstallInfo> {
  const module = getModule();
  if (!module) {
    return {
      command: 'bash ~/skid-backend/bootstrap/install-termux.sh',
      manifestVersion: '1.3.0',
      workstationHome: '~/.rootless-workstation',
    };
  }
  return module.getBootstrapInstallCommand();
}

/** Test hook to inject a native double without loading Expo modules. */
export function __setTermuxModuleForTests(double: SkidTermuxModule | null): void {
  nativeModule = double;
}

export async function databaseOperation(request: DatabaseLifecycleRequest, password?: string): Promise<DatabaseLifecycleResponse> {
  const module = getModule();
  const failure = { ...request, ok: false, completedAt: new Date().toISOString() };
  if (!module) return {...failure, errorKey: 'CAPABILITY_UNAVAILABLE'} as DatabaseLifecycleResponse;
  const response = await module.databaseOperation(JSON.stringify({...request, ...(password ? {password} : {})}));
  if (!response.payload) return {...failure, errorKey: response.errorKey ?? 'PARSER_FAILED', detail: response.detail} as DatabaseLifecycleResponse;
  try {
    const value = JSON.parse(response.payload) as DatabaseLifecycleResponse;
    if (value.profileId !== request.profileId || value.operationId !== request.operationId || value.operation !== request.operation) throw new Error();
    return value;
  } catch { return {...failure, errorKey: 'PARSER_FAILED'} as DatabaseLifecycleResponse; }
}

export async function prepareDatabaseCredential(operationId: string, password: string): Promise<MetasploitScriptResult> {
  return getModule()?.prepareDatabaseCredential(JSON.stringify({operation: 'initialize', profileId: 'termux-local', operationId, password})) ?? {ok: false, errorKey: 'CAPABILITY_UNAVAILABLE'};
}
export async function installWorkstationBundle(helperToken: string): Promise<MetasploitScriptResult> {
  return getModule()?.installWorkstationBundle(helperToken) ?? {ok: false, errorKey: 'CAPABILITY_UNAVAILABLE'};
}
export async function startWorkstationHelper(helperToken: string): Promise<MetasploitScriptResult> {
  return getModule()?.startWorkstationHelper(helperToken) ?? {ok: false, errorKey: 'CAPABILITY_UNAVAILABLE'};
}

export async function checkProfileSwitch(): Promise<MetasploitScriptResult> {
  return getModule()?.checkProfileSwitch() ?? {ok: false, errorKey: 'CAPABILITY_UNAVAILABLE'};
}

export async function probeSetup(): Promise<string> {
  return getModule()?.probeSetup() ?? '{"ok":false,"errorKey":"CAPABILITY_UNAVAILABLE"}';
}
export async function probeKaliSetup(): Promise<string> {
  return getModule()?.probeKaliSetup() ?? '{"ok":false,"errorKey":"CAPABILITY_UNAVAILABLE"}';
}
export async function openTermux(): Promise<boolean> {
  return getModule()?.openTermux() ?? false;
}
