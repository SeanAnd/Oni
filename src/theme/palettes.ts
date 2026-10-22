import { edgerunners } from './themes/edgerunners';
import { ghost } from './themes/ghost';

/** Pure theme data: shared by the UI, persistence validation, and Node tests. */
export type ThemeId = 'sumi' | 'mocha' | 'street' | 'edgerunners' | 'ghost';
export type ThemeMode = 'light' | 'dark';

export interface ThemeColors {
  background: string;
  canvas: string;
  text: string;
  muted: string;
  border: string;
  surface: string;
  surfaceRaised: string;
  surfaceText: string;
  surfaceMuted: string;
  surfaceBorder: string;
  track: string;
  accent: string;
  accentBright: string;
  onAccent: string;
  secondaryAccent: string;
  tertiaryAccent: string;
  success: string;
  successSolid: string;
  info: string;
  danger: string;
  terminalBackground: string;
  terminalText: string;
  terminalPrompt: string;
  terminalInfo: string;
  terminalMuted: string;
}

export interface ThemePalette {
  id: ThemeId;
  name: string;
  shortName: string;
  tag: string;
  description: string;
  mode: ThemeMode;
  treatment: 'ink' | 'matte' | 'street' | 'neon';
  colors: ThemeColors;
  accents: readonly string[];
}

export const THEME_IDS: readonly ThemeId[] = ['sumi', 'mocha', 'street', 'edgerunners', 'ghost'];
export const DEFAULT_THEME: ThemeId = 'sumi';

export const themes: Record<ThemeId, ThemePalette> = {
  sumi: {
    id: 'sumi', name: 'Sumi Ink', shortName: 'Ink', tag: 'ORIGINAL',
    description: 'Washi paper, painted ink, a touch of crimson.',
    mode: 'light', treatment: 'ink',
    colors: {
      background: '#F2EEE5', canvas: '#242420', text: '#101110', muted: '#53534E',
      border: '#D2CEC4', surface: '#1B1C1A', surfaceRaised: '#30322C',
      surfaceText: '#F8F5EC', surfaceMuted: '#C0BEB5', surfaceBorder: '#52544D', track: '#5A5D55',
      accent: '#B6292D', accentBright: '#E05D57', onAccent: '#F8F5EC',
      secondaryAccent: '#72BEF2', tertiaryAccent: '#8CD394',
      success: '#8CD394', successSolid: '#497E50', info: '#72BEF2', danger: '#A12428',
      terminalBackground: '#141613', terminalText: '#F8F5EC', terminalPrompt: '#74E88A',
      terminalInfo: '#86CAF1', terminalMuted: '#B3B5AE',
    },
    accents: ['#E05D57', '#F8F5EC', '#C0BEB5', '#E05D57', '#F8F5EC', '#E05D57'],
  },
  mocha: {
    id: 'mocha', name: 'Catppuccin Mocha', shortName: 'Mocha', tag: 'SOFT MATTE',
    description: 'Cozy charcoal with lilac, peach, and mint accents.',
    mode: 'dark', treatment: 'matte',
    // Catppuccin Mocha palette: https://catppuccin.com/palette/#mocha
    colors: {
      background: '#1E1E2E', canvas: '#11111B', text: '#CDD6F4', muted: '#A6ADC8',
      border: '#45475A', surface: '#282839', surfaceRaised: '#313244',
      surfaceText: '#CDD6F4', surfaceMuted: '#BAC2DE', surfaceBorder: '#45475A', track: '#585B70',
      accent: '#CBA6F7', accentBright: '#CBA6F7', onAccent: '#1E1E2E',
      secondaryAccent: '#94E2D5', tertiaryAccent: '#A6E3A1',
      success: '#A6E3A1', successSolid: '#A6E3A1', info: '#89B4FA', danger: '#F38BA8',
      terminalBackground: '#181825', terminalText: '#CDD6F4', terminalPrompt: '#A6E3A1',
      terminalInfo: '#89B4FA', terminalMuted: '#A6ADC8',
    },
    accents: ['#CBA6F7', '#FAB387', '#94E2D5', '#F5C2E7', '#89B4FA', '#A6E3A1'],
  },
  street: {
    id: 'street', name: 'Street Ink', shortName: 'Street', tag: 'ARCADE MATTE',
    description: 'Paint-swipe pink, electric mint, and acid lime.',
    mode: 'dark', treatment: 'street',
    colors: {
      background: '#191A23', canvas: '#101117', text: '#F0EDF6', muted: '#B7B5CA',
      border: '#464555', surface: '#252630', surfaceRaised: '#31333F',
      surfaceText: '#F0EDF6', surfaceMuted: '#C3C0D1', surfaceBorder: '#464555', track: '#5B5A6B',
      accent: '#EF79D1', accentBright: '#EF79D1', onAccent: '#191A23',
      secondaryAccent: '#6CE6D5', tertiaryAccent: '#D8EF75',
      success: '#D8EF75', successSolid: '#D8EF75', info: '#6CE6D5', danger: '#FFA0A9',
      terminalBackground: '#14151D', terminalText: '#F0EDF6', terminalPrompt: '#D8EF75',
      terminalInfo: '#6CE6D5', terminalMuted: '#B7B5CA',
    },
    accents: ['#6CE6D5', '#EF79D1', '#D8EF75', '#F3AF85', '#A5B7FF', '#6CE6D5'],
  },
  edgerunners,
  ghost,
};

/** Do not trust persisted values or URL parameters (including prototype keys). */
export function isThemeId(value: unknown): value is ThemeId {
  return value === 'sumi' || value === 'mocha' || value === 'street' || value === 'edgerunners' || value === 'ghost';
}
