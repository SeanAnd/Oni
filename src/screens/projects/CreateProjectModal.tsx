import { Controller, type UseFormReturn } from 'react-hook-form';
import { KeyboardAvoidingView, Modal, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FormInput } from '@/components/FormInput';
import { ActionButton } from '@/components/ActionButton';
import { Body, PageHeader } from '@/components/Screen';
import { useTheme } from '@/components/ThemeProvider';
import type { ProjectFormValue } from '@/core/models/projectForm.model';
import { projectFieldMessage } from './projectFieldMessage';

export function CreateProjectModal({ visible, form, busy, message, onCancel, onSubmit }: {
  visible: boolean; form: UseFormReturn<ProjectFormValue>; busy: boolean; message: string;
  onCancel: () => void; onSubmit: () => void;
}) {
  const { colors, theme } = useTheme();
  return <Modal visible={visible} animationType="slide" onRequestClose={onCancel} onDismiss={undefined}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior="height" style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, padding: theme.spacing.lg, gap: 20 }}>
          <View style={{ height: 4, backgroundColor: colors.accent, borderRadius: 2 }} />
          <PageHeader title="New project" subtitle="Give your next investigation a home." />
          {(['name', 'description'] as const).map(field => <View key={field} style={{ gap: 8 }}>
            <Body>{field === 'name' ? 'Project name' : 'Description (optional)'}</Body>
            <Controller control={form.control} name={field} render={({ field: { onChange, onBlur, value, ref } }) => <FormInput
              ref={ref} autoFocus={visible && field === 'name'} accessibilityLabel={field === 'name' ? 'Project name' : 'Project description'}
              value={value} onChangeText={onChange} onBlur={onBlur} editable={!busy} multiline={field === 'description'}
              style={{ minHeight: field === 'description' ? 110 : 56, padding: 16, borderRadius: 10, backgroundColor: colors.surface, color: colors.surfaceText, fontSize: 16, textAlignVertical: 'top' }} /> } />
            {form.formState.errors[field] && <Text accessibilityRole="alert" style={{ color: colors.error }}>{projectFieldMessage(form.formState.errors[field]?.message)}</Text>}
          </View>)}
          {!!message && <Text accessibilityRole="alert" style={{ color: colors.error }}>{message}</Text>}
          <ActionButton label={busy ? 'Creating project…' : 'Create project'} disabled={busy} onPress={onSubmit} />
          <ActionButton label="Cancel" variant="outline" disabled={busy} onPress={onCancel} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  </Modal>;
}
