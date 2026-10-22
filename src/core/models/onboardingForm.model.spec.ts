import { createOnboardingFormValue, onboardingIssuesForStep } from '@/core/models/onboardingForm.model';

describe('onboarding form model', () => {
  it('defaults to termux-local profile with empty secrets', () => {
    const value = createOnboardingFormValue();
    expect(value.profileId).toBe('termux-local');
    expect(value.termuxHelperToken).toBe('');
    expect(value.msfDatabasePassword).toBe('');
  });

  it('rejects retired setup instead of asking for host forwarding', () => {
    const value = createOnboardingFormValue();
    const issues = onboardingIssuesForStep({...value, profileId: 'retired-profile' as typeof value.profileId}, 'metasploit_config');
    expect(issues[0]?.key).toBe('DATABASE_PROFILE_RETIRED');
  });
});
