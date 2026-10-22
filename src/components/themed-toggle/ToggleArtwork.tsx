import { Animated, Image, View } from 'react-native';
import { useMemo } from 'react';
import type { ThemeId } from '@/theme/palettes';
import { toggleAssets, toggleLayers } from '@/theme/toggleAssets';
import { CANVAS, scenes, type NumericTrack, type SceneNode } from './toggleScenes';

function Layer({ node, progress, scale }: { node: SceneNode; progress: Animated.Value; scale: number }) {
  const numeric = (track: NumericTrack = 0, factor = scale) => typeof track === 'number' ? track * factor : progress.interpolate({ inputRange: track.input, outputRange: track.output.map(value => value * factor) });
  const rotation = typeof node.rotate === 'object'
    ? progress.interpolate({ inputRange: node.rotate.input, outputRange: node.rotate.output.map(value => `${value}deg`) })
    : `${node.rotate ?? 0}deg`;
  return <Animated.View style={{ position: 'absolute', left: numeric(node.x), top: numeric(node.y), width: numeric(node.width), height: numeric(node.height), opacity: numeric(node.opacity ?? 1, 1), overflow: node.clip ? 'hidden' : 'visible', transform: [{ rotate: rotation }, { scale: numeric(node.scale ?? 1, 1) }] }}>
    {node.asset && <Image source={toggleLayers[node.asset]} resizeMode="stretch" style={{ width: '100%', height: '100%' }} />}
    {node.children?.map(child => <Layer key={child.id} node={child} progress={progress} scale={scale} />)}
  </Animated.View>;
}
export function ToggleArtwork({ themeId, value, progress, width, still }: { themeId: ThemeId; value: boolean; progress: Animated.Value; width: number; still: boolean }) {
  // Use the adjusted scene at a fixed endpoint so reduced motion and compact
  // controls share the same cartridge alignment as the animated version.
  const endpoint = useMemo(() => new Animated.Value(value ? 1 : 0), [value]);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width, height: width * CANVAS.height / CANVAS.width }}>
    {still && themeId !== 'edgerunners' ? <Image source={toggleAssets[themeId][value ? 'on' : 'off']} resizeMode="contain" style={{ width: '100%', height: '100%' }} /> : scenes[themeId].map(node => <Layer key={node.id} node={node} progress={still ? endpoint : progress} scale={width / CANVAS.width} />)}
  </View>;
}
