const messages: Record<string, string> = {
  PROJECT_NAME_REQUIRED: 'Enter a project name.', PROJECT_NAME_TOO_SHORT: 'Name must be at least 2 characters.',
  PROJECT_NAME_TOO_LONG: 'Name must be 64 characters or fewer.', PROJECT_NAME_INVALID: 'Use letters, numbers, spaces, dots, dashes, or underscores.',
  PROJECT_NAME_RESERVED: 'That name is reserved.', PROJECT_NAME_TAKEN: 'A project with this name already exists.',
  PROJECT_DESCRIPTION_TOO_LONG: 'Description must be 500 characters or fewer.',
};
export function projectFieldMessage(key?: string) { return key ? messages[key] ?? key : ''; }
