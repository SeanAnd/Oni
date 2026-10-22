import { openTermux } from '@/core/integrations/termux/termuxBridgeClient';
import { FormInput as TextInput } from '@/components/FormInput';
import { StyleSheet, Text, View } from 'react-native';
import { Controller, type UseFormReturn } from 'react-hook-form';
import type { OnboardingFormValue, OnboardingStepId } from '@/core/models/onboardingForm.model';
import type { EnvironmentProfileId } from '@/core/models/environmentProfile.model';
import { ActionButton } from '@/components/ActionButton';
import { useThemedStyles } from '@/components/ThemeProvider';
import type { WorkstationTheme } from '@/theme/tokens';
export function OnboardingFields({ form, activeStep, profile, repairNeeded = false, openPermissions }: {
  form: UseFormReturn<OnboardingFormValue>; activeStep: OnboardingStepId; profile: EnvironmentProfileId;
  repairNeeded?: boolean; openPermissions: () => void;
}) {
 const { control } = form;
 const styles = useThemedStyles(createStyles);
 return <>
        {activeStep === 'termux' ? (
          <View style={styles.fieldBlock}>
            {!repairNeeded ? <>
            <Text style={styles.body}>Open Termux once to finish its own setup. Then enable external commands and grant Oni permission to run them.</Text>
            <ActionButton label="Open Termux" onPress={() => { void openTermux(); }} />
            <Text style={styles.hint}>In Termux, paste this line to allow external commands. Long-press to copy it, then return to Oni.</Text>
            <Text selectable style={styles.hint}>{"mkdir -p ~/.termux; printf '\nallow-external-apps=true\n' >> ~/.termux/termux.properties; termux-reload-settings"}</Text>
            <Text style={styles.hint}>In Oni’s app settings, open Permissions, then Additional permissions if shown, and allow Run commands in Termux environment.</Text>
            <ActionButton label="Open Oni permissions" onPress={() => openPermissions()} />
            </> : null}
            {repairNeeded ? <><Text style={styles.hint}>Pairing needs repair. Enter the original helper token for this device.</Text><Controller control={control} name="termuxHelperToken" render={({field: {value, onChange, onBlur}}) => (
              <TextInput accessibilityLabel="Termux helper token" secureTextEntry autoCapitalize="none" autoCorrect={false} value={value} onChangeText={onChange} onBlur={onBlur} style={styles.input} />
            )} />
            </> : null}
          </View>
        ) : null}

        {activeStep === 'database_initialize' && profile === 'termux-local' ? <Text style={styles.body}>Continue to install PostgreSQL if needed and initialize a private database on this device. Initial package downloads need internet.</Text> : null}
        {activeStep === 'metasploit_config' && profile === 'termux-local' ? <Text style={styles.body}>Configure Framework with the securely saved device credential. Close any existing Framework consoles first.</Text> : null}

</>;
}

const createStyles = (theme: WorkstationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  title: { color: theme.colors.text, fontSize: theme.type.title, fontWeight: '700' },
  intro: { color: theme.colors.muted, fontSize: theme.type.body, lineHeight: 24 },
  stepLabel: { color: theme.colors.accent, fontSize: theme.type.label, textTransform: 'uppercase' },
  body: { color: theme.colors.text, fontSize: theme.type.body, lineHeight: 24 },
  fieldBlock: { gap: theme.spacing.sm },
  fieldLabel: { color: theme.colors.text, fontSize: theme.type.body, fontWeight: '600' },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.control,
    color: theme.colors.surfaceText,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { color: theme.colors.muted, fontSize: theme.type.label, lineHeight: 18 },
  detail: { color: theme.colors.text, fontSize: theme.type.body, lineHeight: 22 },
  fieldError: { color: theme.colors.error, fontSize: theme.type.body, lineHeight: 22 },
});
