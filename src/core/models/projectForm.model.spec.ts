import {
  createProjectFormValue,
  toCreateProjectInput,
} from '@/core/models/projectForm.model';

describe('project form model', () => {
  it('defaults required strings to empty values', () => {
    expect(createProjectFormValue()).toEqual({ name: '', description: '' });
  });

  it('maps trimmed values to repository input', () => {
    expect(
      toCreateProjectInput({
        name: '  Lab Alpha  ',
        description: '  notes  ',
      }),
    ).toEqual({
      name: 'Lab Alpha',
      description: 'notes',
    });
  });
});
