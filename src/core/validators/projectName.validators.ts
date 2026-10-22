import type { ProjectFormValue } from '@/core/models/projectForm.model';

const PROJECT_NAME_MIN = 2;
const PROJECT_NAME_MAX = 64;
const PROJECT_DESCRIPTION_MAX = 500;

const RESERVED_PROJECT_NAMES = new Set(['system', 'default', 'admin', 'skid', 'oni']);

export type ProjectNameErrorKey =
  | 'PROJECT_NAME_REQUIRED'
  | 'PROJECT_NAME_TOO_SHORT'
  | 'PROJECT_NAME_TOO_LONG'
  | 'PROJECT_NAME_INVALID'
  | 'PROJECT_NAME_RESERVED'
  | 'PROJECT_NAME_TAKEN'
  | 'PROJECT_DESCRIPTION_TOO_LONG';

export interface ProjectFormValidationResult {
  ok: boolean;
  fieldErrors?: Partial<Record<keyof ProjectFormValue, string>>;
  formError?: string;
}

export interface ProjectValidationContext {
  nameTaken: (name: string) => boolean;
}

export function validateProjectName(name: string): ProjectNameErrorKey | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'PROJECT_NAME_REQUIRED';
  }
  if (trimmed.length < PROJECT_NAME_MIN) {
    return 'PROJECT_NAME_TOO_SHORT';
  }
  if (trimmed.length > PROJECT_NAME_MAX) {
    return 'PROJECT_NAME_TOO_LONG';
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(trimmed)) {
    return 'PROJECT_NAME_INVALID';
  }
  if (RESERVED_PROJECT_NAMES.has(trimmed.toLowerCase())) {
    return 'PROJECT_NAME_RESERVED';
  }
  return null;
}

export function validateProjectDescription(description: string): ProjectNameErrorKey | null {
  if (description.trim().length > PROJECT_DESCRIPTION_MAX) {
    return 'PROJECT_DESCRIPTION_TOO_LONG';
  }
  return null;
}

export function validateProjectFormValue(
  value: ProjectFormValue,
  context: ProjectValidationContext,
): ProjectFormValidationResult {
  const fieldErrors: Partial<Record<keyof ProjectFormValue, string>> = {};
  const nameError = validateProjectName(value.name);
  if (nameError) {
    fieldErrors.name = nameError;
  } else if (context.nameTaken(value.name.trim())) {
    fieldErrors.name = 'PROJECT_NAME_TAKEN';
  }

  const descriptionError = validateProjectDescription(value.description);
  if (descriptionError) {
    fieldErrors.description = descriptionError;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true };
}
