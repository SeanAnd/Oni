import { createOnboardingFormValue } from '@/core/models/onboardingForm.model';
import { validateOnboardingForm } from './onboarding.validators';
it('rejects retired host setup regardless of stored legacy fields',()=>{
 const value={...createOnboardingFormValue(),profileId:'retired-profile' as ReturnType<typeof createOnboardingFormValue>['profileId']};
 expect(validateOnboardingForm(value,{step:'metasploit_config'})).toEqual([{field:'profileId',key:'DATABASE_PROFILE_RETIRED'}]);
});
it('allows fresh device pairing but validates an optional recovery token',()=>{
 const value=createOnboardingFormValue();
 expect(validateOnboardingForm(value,{step:'termux'})).toEqual([]);
 expect(validateOnboardingForm({...value,termuxHelperToken:'invalid'},{step:'termux'})).toEqual([{field:'termuxHelperToken',key:'PERMISSION_DENIED'}]);
 expect(validateOnboardingForm({...value,termuxHelperToken:'a'.repeat(64)},{step:'termux'})).toEqual([]);
});
