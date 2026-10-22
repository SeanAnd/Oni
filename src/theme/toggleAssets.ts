import type { ImageSourcePropType } from 'react-native';
import type { ThemeId } from './palettes';

export const toggleLayers: Record<string, ImageSourcePropType> = {
  'edgerunners/base': require('../../assets/oni/toggles/edgerunners/base.png'),
  'edgerunners/base-off': require('../../assets/oni/toggles/edgerunners/base-off.png'),
  'edgerunners/cartridge': require('../../assets/oni/toggles/edgerunners/cartridge.png'),
  'edgerunners/cartridge-off': require('../../assets/oni/toggles/edgerunners/cartridge-off.png'),
  'ghost/base': require('../../assets/oni/toggles/ghost/base.png'),
  'ghost/base-off': require('../../assets/oni/toggles/ghost/base-off.png'),
  'ghost/orb': require('../../assets/oni/toggles/ghost/orb.png'),
  'ghost/orb-off': require('../../assets/oni/toggles/ghost/orb-off.png'),
  'mocha/base': require('../../assets/oni/toggles/mocha/base.png'),
  'mocha/base-off': require('../../assets/oni/toggles/mocha/base-off.png'),
  'mocha/moon': require('../../assets/oni/toggles/mocha/moon.png'),
  'mocha/moon-off': require('../../assets/oni/toggles/mocha/moon-off.png'),
  'mocha/star': require('../../assets/oni/toggles/mocha/star.png'),
  'street/base': require('../../assets/oni/toggles/street/base.png'),
  'street/base-off': require('../../assets/oni/toggles/street/base-off.png'),
  'street/can': require('../../assets/oni/toggles/street/can.png'),
  'street/paint': require('../../assets/oni/toggles/street/paint.png'),
  'sumi/base': require('../../assets/oni/toggles/sumi/base.png'),
  'sumi/paper': require('../../assets/oni/toggles/sumi/paper.png'),
  'sumi/roller-left': require('../../assets/oni/toggles/sumi/roller-left.png'),
  'sumi/roller-right': require('../../assets/oni/toggles/sumi/roller-right.png'),
  'sumi/seal': require('../../assets/oni/toggles/sumi/seal.png'),
};

export const toggleAssets: Record<ThemeId, { off: ImageSourcePropType; on: ImageSourcePropType }> = {
  sumi: { off: require('../../assets/oni/toggles/sumi/off.png'), on: require('../../assets/oni/toggles/sumi/on.png') },
  mocha: { off: require('../../assets/oni/toggles/mocha/off.png'), on: require('../../assets/oni/toggles/mocha/on.png') },
  street: { off: require('../../assets/oni/toggles/street/off.png'), on: require('../../assets/oni/toggles/street/on.png') },
  edgerunners: { off: require('../../assets/oni/toggles/edgerunners/off.png'), on: require('../../assets/oni/toggles/edgerunners/on.png') },
  ghost: { off: require('../../assets/oni/toggles/ghost/off.png'), on: require('../../assets/oni/toggles/ghost/on.png') },
};
