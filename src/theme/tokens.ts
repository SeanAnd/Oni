import { themes, type ThemeId } from './palettes';
export function createTheme(id: ThemeId) {
  const palette = themes[id];
  return {
    ...palette,
    colors: { ...palette.colors, warning: palette.colors.secondaryAccent, error: palette.colors.danger, selection: palette.colors.accent, selectionSurface: palette.colors.surfaceRaised },
    fonts: { heading: palette.treatment === 'ink' ? 'serif' : 'sans-serif', body: 'sans-serif', mono: 'monospace' },
    spacing: { xs: 4, sm: 8, md: 16, lg: 22, xl: 32 },
    type: { label: 13, body: 16, title: 26, display: 42 },
    radius: { panel: 12, control: 10 },
  };
}
export type WorkstationTheme = ReturnType<typeof createTheme>;
export const theme = createTheme('sumi');
