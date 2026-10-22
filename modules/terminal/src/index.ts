import { requireNativeModule, requireNativeViewManager } from 'expo-modules-core';
import type { ComponentType, Ref } from 'react';
import type { ViewProps } from 'react-native';
import type { TerminalPreset, TerminalSessionSummary } from '@/core/models/terminalSession.model';
interface TerminalNative {
  detect(): Promise<{ok: boolean; presets: TerminalPreset[]}>;
  status(): TerminalSessionSummary;
  start(token: string, preset: TerminalPreset): Promise<TerminalSessionSummary>;
  close(): Promise<TerminalSessionSummary>;
}
export const Terminal = requireNativeModule<TerminalNative>('OniTerminal');
export interface TerminalViewHandle { sendKey(key: string): Promise<void> }
export const TerminalView = requireNativeViewManager('OniTerminal') as ComponentType<ViewProps & {palette: { background: string; foreground: string }; ref?: Ref<TerminalViewHandle>}>;
