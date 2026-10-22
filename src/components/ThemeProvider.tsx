import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createTheme, theme, type WorkstationTheme } from '@/theme/tokens';
import type { ThemeId } from '@/theme/palettes';
import { readAppearance, writeAppearance } from '@/core/state/appearancePreference';
interface ThemeContextValue {
  theme: WorkstationTheme;
  colors: WorkstationTheme['colors'];
  ready: boolean;
  error: string | null;
  selectTheme: (id: ThemeId) => void;
}
const Context = createContext<ThemeContextValue>({ theme, colors: theme.colors, ready: true, error: null, selectTheme: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(() => {
    try { return { id: readAppearance(), error: null }; }
    catch { return { id: 'sumi' as const, error: 'Saved appearance could not be loaded.' }; }
  });
  const [id, setId] = useState<ThemeId>(initial.id);
  const [error, setError] = useState<string | null>(initial.error);
  const ready = true;
  const current = useMemo(() => createTheme(id), [id]);
  const selectTheme = (next: ThemeId) => {
    setId(next);
    try { writeAppearance(next); setError(null); }
    catch { setError('Appearance changed for this session; saving failed.'); }
  };
  return <Context.Provider value={{ theme: current, colors: current.colors, ready, error, selectTheme }}>{children}</Context.Provider>;
}
export const useTheme = () => useContext(Context);
export function useThemedStyles<T>(factory: (theme: WorkstationTheme) => T): T {
  const { theme } = useTheme();
  return useMemo(() => factory(theme), [factory, theme]);
}
