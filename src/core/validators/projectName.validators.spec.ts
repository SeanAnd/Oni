import { validateProjectFormValue, validateProjectName } from '@/core/validators/projectName.validators';

describe('project name validators', () => {
  it('rejects empty and reserved names', () => {
    expect(validateProjectName('')).toBe('PROJECT_NAME_REQUIRED');
    expect(validateProjectName('system')).toBe('PROJECT_NAME_RESERVED');
  });

  it('validates the full form and duplicate names', () => {
    const invalid = validateProjectFormValue({ name: 'a', description: '' }, { nameTaken: () => false });
    expect(invalid.ok).toBe(false);
    expect(invalid.fieldErrors?.name).toBe('PROJECT_NAME_TOO_SHORT');

    const taken = validateProjectFormValue({ name: 'Lab', description: '' }, { nameTaken: () => true });
    expect(taken.fieldErrors?.name).toBe('PROJECT_NAME_TAKEN');
  });
});
