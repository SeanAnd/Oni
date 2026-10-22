import type { Resolver } from 'react-hook-form';

import type { CreateProjectInput } from '@/core/storage/projectRepository';
import { validateProjectFormValue, type ProjectFormValidationResult } from '@/core/validators/projectName.validators';

export interface ProjectFormValue {
  name: string;
  description: string;
}

export function createProjectFormValue(): ProjectFormValue {
  return {
    name: '',
    description: '',
  };
}

export interface ProjectFormResolverContext {
  nameTaken: (name: string) => boolean;
}

export function projectFormResolver(context: ProjectFormResolverContext): Resolver<ProjectFormValue> {
  return async (values) => {
    const result = validateProjectFormValue(values, context);
    if (result.ok) {
      return { values, errors: {} };
    }
    const errors: Record<string, { type: string; message: string }> = {};
    for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
      errors[field] = { type: 'validation', message };
    }
    if (result.formError) {
      errors.root = { type: 'validation', message: result.formError };
    }
    return { values: {}, errors };
  };
}

export function toCreateProjectInput(value: ProjectFormValue): CreateProjectInput {
  return {
    name: value.name.trim(),
    description: value.description.trim(),
  };
}

export type { ProjectFormValidationResult };
