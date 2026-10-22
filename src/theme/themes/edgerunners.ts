import type { ThemePalette } from '../palettes';

/**
 * Visual-only import from the supplied Edgerunners theme archive.
 * Color roles are mapped to the existing palette contract; no provider,
 * persistence, navigation, or application behavior is imported.
 */
export const edgerunners: ThemePalette = {
  id: 'edgerunners', name: 'Edgerunners', shortName: 'Edgerunners', tag: 'NEON CIRCUIT',
  description: 'Midnight panels, acid yellow, cyan, and hot pink.',
  mode: 'dark', treatment: 'neon',
  colors: {
    background: '#0A101A', canvas: '#050910', text: '#F0F5F5', muted: '#A4B9CB',
    border: '#2D455B', surface: '#131F2D', surfaceRaised: '#182A3D',
    surfaceText: '#F0F5F5', surfaceMuted: '#A4B9CB', surfaceBorder: '#30465D', track: '#30465D',
    accent: '#F3FF00', accentBright: '#F3FF00', onAccent: '#0A101A',
    secondaryAccent: '#00E5FF', tertiaryAccent: '#FF3EA5',
    success: '#7EFFA3', successSolid: '#7EFFA3', info: '#00E5FF', danger: '#FF79BA',
    terminalBackground: '#0A101A', terminalText: '#F0F5F5', terminalPrompt: '#7EFFA3',
    terminalInfo: '#00E5FF', terminalMuted: '#A4B9CB',
  },
  // Preserve the donor's tool-icon sequence: cyan / pink / cyan / pink / cyan / yellow.
  accents: ['#00E5FF', '#FF3EA5', '#00E5FF', '#FF3EA5', '#00E5FF', '#F3FF00'],
};
