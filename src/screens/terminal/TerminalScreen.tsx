import { useSetupGate } from '@/components/setup/useSetupGate';
import { useModalService } from '@/components/modals/ModalProvider';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View } from 'react-native';

import { useRouter } from 'expo-router';
import { useTheme } from '@/components/ThemeProvider';
import { ActionButton } from '@/components/ActionButton';
import { TerminalView, type TerminalViewHandle } from '~/modules/terminal/src';
import { closeTerminal, openTerminal, terminalStatus } from '@/core/integrations/terminal/terminalClient';
import type { TerminalPreset } from '@/core/models/terminalSession.model';
export function TerminalScreen() {
  const { colors } = useTheme();
  const router=useRouter();
  const closeTrigger=useRef<View>(null);
  const startTrigger=useRef<View>(null);
  const checkSetup=useSetupGate(startTrigger);
  const showModal=useModalService(closeTrigger);
  const pending=useRef(false);
  const [headerHeight,setHeaderHeight]=useState(0);
  const container=useRef<View>(null);
  const [status,setStatus]=useState(terminalStatus);
  const [preset,setPreset]=useState<TerminalPreset>('termux');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const terminal=useRef<TerminalViewHandle>(null);
  useEffect(()=>{const timer=setInterval(()=>setStatus(terminalStatus()),600);return()=>clearInterval(timer)},[]);
  async function start() {
    if (pending.current) return;
    pending.current=true; setBusy(true); setError('');
    try { if (preset !== 'termux' && !(await checkSetup())) return; setStatus(await openTerminal(preset)); }
    catch(e) { setError(e instanceof Error ? e.message : 'Terminal unavailable.'); }
    finally { pending.current=false; setBusy(false); }
  }
  async function close() {
    if (pending.current) return;
    pending.current=true; setBusy(true);
    try {
      const choice=await showModal({title:'Close terminal session?',body:'The shell and its running command will be stopped.',primaryLabel:'Close session',secondaryLabel:'Cancel',tone:'danger',dedupeKey:'close-terminal'});
      if (choice === 'primary') setStatus(await closeTerminal());
    } catch { setError('Could not close the session. Retry after recovering Termux.'); }
    finally { pending.current=false; setBusy(false); }
  }
  const idle=status.state==='idle';
  return <View ref={container} style={{flex:1}} onLayout={() => container.current?.measureInWindow((_x,y)=>setHeaderHeight(y))}><KeyboardAvoidingView behavior="height" keyboardVerticalOffset={headerHeight} style={{flex:1,backgroundColor:colors.terminalBackground}}>
    <View style={{padding:14,gap:10,backgroundColor:colors.surface}}>
      <Text accessibilityLiveRegion="polite" style={{color:colors.surfaceText,fontSize:16}}>{status.detail}</Text>
      {error ? <Text style={{color:colors.surfaceText}}>{error}</Text>:null}
      {idle ? <><View style={{flexDirection:'row',flexWrap:'wrap',gap:12}}>{(['termux','kali','metasploit'] as const).map(value=><Pressable key={value} accessibilityRole="radio" accessibilityState={{checked:preset===value,disabled:busy}} disabled={busy} onPress={()=>setPreset(value)} style={{minHeight:48,padding:12,borderWidth:2,borderColor:preset===value?colors.accentBright:colors.surfaceBorder}}><Text style={{color:colors.surfaceText}}>{value==='termux'?'Termux':value==='kali'?'Kali':'Metasploit'}</Text></Pressable>)}</View><ActionButton buttonRef={startTrigger} label={busy?'Starting…':'Start terminal'} disabled={busy} onPress={()=>void start()} /><ActionButton label="Terminal setup" onPress={()=>router.push('/settings')} /></> : <Pressable ref={closeTrigger} accessibilityRole="button" disabled={busy} onPress={() => void close()} style={{minHeight:48,justifyContent:'center'}}><Text style={{color:colors.surfaceText}}>Close session</Text></Pressable>}
    </View>
    {!idle && <TerminalView ref={terminal} accessibilityLabel="Interactive Termux terminal" style={{flex:1}} palette={{background:colors.terminalBackground,foreground:colors.terminalText}} />}
    {idle && <View style={{flex:1,padding:22}}><Text style={{color:colors.terminalMuted,fontSize:16}}>A real shell on this device. Sessions keep running when you switch tabs. Termux must be installed and configured.</Text></View>}
    {!idle && <View style={{backgroundColor:colors.surface}}><ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={{gap:2}}>{[['Esc','\u001b'],['Tab','\t'],['Ctrl','ctrl'],['Ctrl-C','\u0003'],['↑','\u001b[A'],['↓','\u001b[B'],['←','\u001b[D'],['→','\u001b[C'],['Copy','copy'],['Paste','paste'],['Keyboard','keyboard']].map(([label,value])=><Pressable key={label} accessibilityRole="button" accessibilityLabel={label} onPress={()=>void terminal.current?.sendKey(value)} style={{minWidth:48,minHeight:52,padding:12,justifyContent:'center'}}><Text style={{color:colors.surfaceText}}>{label}</Text></Pressable>)}</ScrollView></View>}
  </KeyboardAvoidingView></View>;
}
