import { readEnvironmentProfile } from '@/core/state/environmentProfile';
import { termuxPostgresqlProvider } from './termuxPostgresqlProvider';
export async function selectedDatabaseProvider() {
  await readEnvironmentProfile();
  return termuxPostgresqlProvider;
}
