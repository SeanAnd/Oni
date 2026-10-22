import { useRef } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ModalRequest, ModalResult } from '@/core/models/modal.model';
import { useTheme } from '../ThemeProvider';
import { Icon } from '../Icon';
import { ActionButton } from '../ActionButton';

export function ThemedModal({ request, resolve }: {request: ModalRequest; resolve: (result: ModalResult) => void}) {
  const {colors, theme} = useTheme();
  const insets = useSafeAreaInsets();
  const heading = useRef<Text>(null);
  const accent = request.tone === 'danger' ? colors.error : request.tone === 'warning' ? colors.warning : colors.accent;
  return <Modal testID="themed-modal" transparent animationType="none" onRequestClose={() => resolve('dismissed')} onShow={() => {
    const tag = findNodeHandle(heading.current); if (tag) AccessibilityInfo.setAccessibilityFocus(tag);
  }}>
    <View accessibilityViewIsModal style={{flex:1, justifyContent:'center', paddingHorizontal:theme.spacing.lg, paddingTop:insets.top + 16, paddingBottom:insets.bottom + 16, backgroundColor:colors.canvas}}>
      <Pressable accessible={false} testID="modal-backdrop" onPress={() => { if (request.dismissOnBackdrop) resolve('dismissed'); }} style={{position:'absolute',top:0,bottom:0,left:0,right:0}} />
      <ScrollView style={{flexGrow:0, maxHeight:'100%', borderRadius:theme.radius.panel, borderWidth:2, borderColor:accent, backgroundColor:colors.background}} contentContainerStyle={{padding:theme.spacing.lg,gap:theme.spacing.md}}>
        <Icon name={request.tone === 'warning' ? 'warning' : 'info'} color={accent} size={32} />
        <Text ref={heading} accessibilityRole="header" style={{color:colors.text,fontFamily:theme.fonts.heading,fontSize:theme.type.title}}>{request.title}</Text>
        <Text style={{color:colors.text,fontSize:theme.type.body,lineHeight:24}}>{request.body}</Text>
        <ActionButton label={request.primaryLabel} onPress={() => resolve('primary')} />
        {request.secondaryLabel && <ActionButton variant="outline" label={request.secondaryLabel} onPress={() => resolve('secondary')} />}
      </ScrollView>
    </View>
  </Modal>;
}
