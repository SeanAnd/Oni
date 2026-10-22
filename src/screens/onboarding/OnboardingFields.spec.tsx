import { render, screen, userEvent } from '@testing-library/react-native';
import { useForm, useWatch } from 'react-hook-form';
import { OnboardingFields } from './OnboardingFields';
import { createOnboardingFormValue, type OnboardingFormValue } from '@/core/models/onboardingForm.model';
import { Text } from 'react-native';
function Fixture() {
 const form = useForm<OnboardingFormValue>({defaultValues: createOnboardingFormValue()});
 const value = useWatch({control: form.control, name: 'termuxHelperToken'});
 return <><OnboardingFields form={form} profile="termux-local" activeStep="termux" repairNeeded openPermissions={() => {}} /><Text>{value}</Text></>;
}
it('binds the extracted step to the parent form and keeps credential entry masked', async () => {
 await render(<Fixture />);
 await userEvent.type(screen.getByLabelText('Termux helper token'), 'test-only-token');
 expect(screen.getByText('test-only-token')).toBeOnTheScreen();
 expect(screen.getByLabelText('Termux helper token').props.secureTextEntry).toBe(true);
});

it('does not ask for a helper token during normal setup', async () => {
 function Fresh() { const form=useForm<OnboardingFormValue>({defaultValues:createOnboardingFormValue()});return <OnboardingFields form={form} profile="termux-local" activeStep="termux" openPermissions={() => {}} />; }
 await render(<Fresh />);
 expect(screen.queryByLabelText('Termux helper token')).toBeNull();
 expect(screen.getByRole('button', {name:'Open Termux'})).toBeOnTheScreen();
});
