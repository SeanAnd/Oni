import { createDatabaseCredentialRepairFormValue, validDeviceDatabasePassword } from './databaseCredentialRepair.model';
it('requires an explicit original credential and rejects SQL/control text', () => {
  expect(createDatabaseCredentialRepairFormValue()).toEqual({password: ''});
  expect(validDeviceDatabasePassword('a'.repeat(64))).toBe(true);
  for (const password of ['', 'short', 'a'.repeat(129), 'a'.repeat(32)+'\n', "'; DROP ROLE msf;--"]) expect(validDeviceDatabasePassword(password)).toBe(false);
});
