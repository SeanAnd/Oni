import type { ProviderId } from '@/core/capabilities/providerIds';

/** The supported on-device database profile. */
export type EnvironmentProfileId = 'termux-local';

export interface EnvironmentProfile {
  id: EnvironmentProfileId;
  label: string;
  description: string;
  databaseProviderId: ProviderId;
}

export const TERMUX_LOCAL_PROFILE: EnvironmentProfile = {
  id: 'termux-local',
  label: 'Termux PostgreSQL (device)',
  description:
    'Metasploit database runs inside Termux on the device. Independent of host forwarding and Metro.',
  databaseProviderId: 'provider.termux.postgresql',
};

export const ENVIRONMENT_PROFILES: Record<EnvironmentProfileId, EnvironmentProfile> = {
  'termux-local': TERMUX_LOCAL_PROFILE,
};

export function getEnvironmentProfile(id: EnvironmentProfileId): EnvironmentProfile {
  return ENVIRONMENT_PROFILES[id];
}
