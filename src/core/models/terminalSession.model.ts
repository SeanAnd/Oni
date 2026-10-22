export type TerminalPreset = 'termux' | 'kali' | 'metasploit';
export interface TerminalSessionSummary {
  state: 'idle' | 'starting' | 'connecting' | 'running' | 'disconnected' | 'exited';
  detail: string;
  preset: TerminalPreset;
}
