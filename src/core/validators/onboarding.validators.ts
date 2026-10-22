import type { OnboardingFormValue, OnboardingStepId } from '@/core/models/onboardingForm.model';
import type { SkidErrorKey } from '@/core/security/errorKeys';
export interface OnboardingValidationIssue { field: keyof OnboardingFormValue; key: SkidErrorKey }
export interface OnboardingValidationContext { step: OnboardingStepId }
/** Setup only configures this device; reject stale or unsupported profile values. */
export function validateOnboardingForm(values: OnboardingFormValue, context: OnboardingValidationContext): OnboardingValidationIssue[] {
  if (values.profileId !== 'termux-local') return [{field:'profileId',key:'DATABASE_PROFILE_RETIRED'}];
  if (context.step === 'termux' && values.termuxHelperToken && !/^[A-Za-z0-9_-]{32,128}$/.test(values.termuxHelperToken)) return [{field:'termuxHelperToken',key:'PERMISSION_DENIED'}];
  return [];
}
