export interface Observation {
  type: string;
  source: string;
  targetId?: string;
  jobId?: string;
  projectId?: string;
  data: Record<string, unknown>;
  observedAt?: string;
}

export const OBSERVATION_TYPES = [
  'network.host',
  'network.service',
  'network.port',
  'wifi.access_point',
  'workstation.health',
] as const;

export type ObservationType = (typeof OBSERVATION_TYPES)[number];
