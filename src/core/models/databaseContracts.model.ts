import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';

export const DATABASE_OPERATIONS = [
  'detect',
  'install',
  'backup',
  'restore',
  'rollback',
  'initialize',
  'start',
  'stop',
  'health',
] as const;

export type DatabaseOperation = (typeof DATABASE_OPERATIONS)[number];

export interface DatabaseOperationContext {
  profileId: EnvironmentProfileId;
  operationId: string;
}

export interface DatabaseDetectRequest extends DatabaseOperationContext {
  operation: 'detect';
}

export interface DatabaseInitializeRequest extends DatabaseOperationContext {
  operation: 'initialize';
}

export interface DatabaseStartRequest extends DatabaseOperationContext {
  operation: 'start';
}

export interface DatabaseStopRequest extends DatabaseOperationContext {
  operation: 'stop';
}

export interface DatabaseHealthRequest extends DatabaseOperationContext {
  operation: 'health';
}

export interface DatabaseMaintenanceRequest extends DatabaseOperationContext {
  operation: 'install' | 'backup' | 'restore' | 'rollback';
  backupId?: string;
  rollbackId?: string;
  confirmReplace?: boolean;
}

export type DatabaseLifecycleRequest =
  | DatabaseMaintenanceRequest
  | DatabaseDetectRequest
  | DatabaseInitializeRequest
  | DatabaseStartRequest
  | DatabaseStopRequest
  | DatabaseHealthRequest;

export interface DatabaseOperationResultBase {
  jobId?: string;
  operationId: string;
  profileId: EnvironmentProfileId;
  ok: boolean;
  errorKey?: SkidErrorKey;
  detail?: string;
  completedAt: string;
}

export interface DatabaseDetectResponse extends DatabaseOperationResultBase {
  operation: 'detect';
  packageInstalled?: boolean;
  clusterInitialized?: boolean;
  serverReachable?: boolean;
}

export interface DatabaseInitializeResponse extends DatabaseOperationResultBase {
  operation: 'initialize';
  alreadyInitialized: boolean;
}

export interface DatabaseStartResponse extends DatabaseOperationResultBase {
  operation: 'start';
  running: boolean;
}

export interface DatabaseStopResponse extends DatabaseOperationResultBase {
  operation: 'stop';
  running: boolean;
}

export interface DatabaseHealthResponse extends DatabaseOperationResultBase {
  operation: 'health';
  packageInstalled?: boolean;
  clusterInitialized?: boolean;
  serverReachable?: boolean;
  databaseSizeBytes?: number;
  authenticatedQueryOk: boolean;
  schemaReady: boolean;
}

export interface DatabaseMaintenanceResponse extends DatabaseOperationResultBase {
  operation: 'install' | 'backup' | 'restore' | 'rollback';
  backupId?: string;
  rollbackId?: string;
  sha256?: string;
  size?: number;
  rollbackDatabase?: string;
}

export type DatabaseLifecycleResponse =
  | DatabaseMaintenanceResponse
  | DatabaseDetectResponse
  | DatabaseInitializeResponse
  | DatabaseStartResponse
  | DatabaseStopResponse
  | DatabaseHealthResponse;
