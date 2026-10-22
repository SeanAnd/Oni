import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';
import type { FieldErrors, Resolver } from 'react-hook-form';

import {
  validateOnboardingForm,
  type OnboardingValidationIssue,
} from '@/core/validators/onboarding.validators';

export const ONBOARDING_STEPS = [
  'termux',
  'kali_health',
  'database_initialize',
  'database_start',
  'metasploit_config',
  'metasploit_verify',
  'complete',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingFormValue {
  profileId: EnvironmentProfileId;
  termuxHelperToken: string;
  bootstrapInstallAcknowledged: boolean;
  msfDatabasePassword: string;
}

export function createOnboardingFormValue(): OnboardingFormValue {
  return {
    profileId: 'termux-local',
    termuxHelperToken: '',
    bootstrapInstallAcknowledged: false,
    msfDatabasePassword: '',
  };
}

export type OnboardingFormField = keyof OnboardingFormValue;

export function onboardingFormResolver(): Resolver<OnboardingFormValue> {
  return async (values) => {
    const issues = validateOnboardingForm(values, { step: 'metasploit_config' });
    if (issues.length === 0) {
      return { values, errors: {} };
    }
    const errors: FieldErrors<OnboardingFormValue> = {};
    for (const issue of issues) {
      errors[issue.field] = {
        type: issue.key,
        message: issue.key,
      };
    }
    return { values: {}, errors };
  };
}

export function onboardingIssuesForStep(
  values: OnboardingFormValue,
  step: OnboardingStepId,
): OnboardingValidationIssue[] {
  return validateOnboardingForm(values, { step });
}

export function stepErrorKey(issues: OnboardingValidationIssue[]): SkidErrorKey | undefined {
  return issues[0]?.key;
}
