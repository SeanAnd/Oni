import { forwardRef } from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useTheme } from './ThemeProvider';
/** RHF owns values and validation; this component owns the shared input treatment. */
export const FormInput = forwardRef<TextInput, TextInputProps>(function FormInput(props, ref) {
  const { colors } = useTheme();
  return <TextInput ref={ref} placeholderTextColor={colors.surfaceMuted} selectionColor={colors.accentBright} {...props} style={[{ minHeight: 56, padding: 16, borderWidth: 1, borderColor: colors.surfaceBorder, borderRadius: 10, backgroundColor: colors.surface, color: colors.surfaceText, fontSize: 16, textAlignVertical: props.multiline ? 'top' : 'center' }, props.style]} />;
});
