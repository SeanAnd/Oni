import { useState } from 'react';
import { Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { useTheme } from '@/components/ThemeProvider';

export function SetupHelp({ title, children }: {title: string; children: React.ReactNode}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  return <View style={{gap: 8}}>
    <ActionButton variant="outline" label={open ? `Hide ${title.toLowerCase()}` : title} onPress={() => setOpen(!open)} />
    {open ? <View style={{gap: 8}}><Text style={{color: colors.muted}}>{children}</Text></View> : null}
  </View>;
}
