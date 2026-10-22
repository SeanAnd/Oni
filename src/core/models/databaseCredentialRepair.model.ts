import type { Resolver, ResolverResult } from 'react-hook-form';
export interface DatabaseCredentialRepairFormValue { password: string }
export function createDatabaseCredentialRepairFormValue(): DatabaseCredentialRepairFormValue { return {password: ''}; }
export function validDeviceDatabasePassword(password: string): boolean { return /^[A-Za-z0-9_-]{32,128}$/.test(password); }
export const databaseCredentialRepairResolver: Resolver<DatabaseCredentialRepairFormValue> = async (values): Promise<ResolverResult<DatabaseCredentialRepairFormValue>> => {
  if (validDeviceDatabasePassword(values.password)) return {values, errors: {}};
  return {values: {}, errors: {password: {type: 'DATABASE_CREDENTIALS_INVALID', message: 'DATABASE_CREDENTIALS_INVALID'}}};
};
