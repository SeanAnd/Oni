import type { ThemePalette } from '../palettes';

/**
 * Ghost: a color-only preset using the existing matte components.
 * The black-metal / violet palette is inspired by the supplied references.
 * Mint success and rose error tokens remain distinct from decorative purple.
 */
export const ghost: ThemePalette = {
  id: 'ghost', name: 'Ghost', shortName: 'Ghost', tag: 'SPECTRAL MATTE',
  description: 'Obsidian black, spectral violet, smoky lavender, and cool magenta.',
  mode: 'dark', treatment: 'matte',
  colors: {
    background: '#0C0A10', canvas: '#060509', text: '#F0EBF6', muted: '#AAA0B8',
    border: '#3B304E', surface: '#15121C', surfaceRaised: '#211A2C',
    surfaceText: '#F0EBF6', surfaceMuted: '#BDB0CC', surfaceBorder: '#3B304E', track: '#4D3D60',
    accent: '#B875F5', accentBright: '#D39AFF', onAccent: '#0C0812',
    secondaryAccent: '#C4B5FD', tertiaryAccent: '#E291DC',
    success: '#9AD5BC', successSolid: '#9AD5BC', info: '#C4B5FD', danger: '#F296AE',
    terminalBackground: '#08060C', terminalText: '#EBE3F6', terminalPrompt: '#CD94FF',
    terminalInfo: '#BAB8E5', terminalMuted: '#A79BAF',
  },
  accents: ['#B875F5', '#C4B5FD', '#E291DC', '#BDB0CC', '#D39AFF', '#BAB8E5'],
};
