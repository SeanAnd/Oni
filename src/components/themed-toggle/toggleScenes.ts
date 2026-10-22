import type { ThemeId } from '@/theme/palettes';
/** Artwork coordinates adapted from the Toggle PoC, in a 360 × 160 canvas. */
export type NumericTrack = number | { input: number[]; output: number[] };
export interface SceneNode {
  id: string; asset?: string; x: NumericTrack; y: NumericTrack;
  width: NumericTrack; height: NumericTrack; opacity?: NumericTrack;
  rotate?: NumericTrack; scale?: NumericTrack; clip?: boolean; children?: SceneNode[];
}
export const CANVAS = {width: 360, height: 160};
export const durations: Record<ThemeId, number> = {sumi:780, mocha:680, street:570, edgerunners:580, ghost:780};
export const scenes: Record<ThemeId, SceneNode[]> = {
  sumi: [
    {"id":"scroll-reveal","x":{"input":[0,1],"output":[176,44]},"y":45,"width":{"input":[0,1],"output":[8,272]},"height":81,"clip":true,"children":[{"id":"landscape","asset":"sumi/paper","x":{"input":[0,1],"output":[-132,0]},"y":0,"width":272,"height":81}]},
    {"id":"left-roller","asset":"sumi/roller-left","x":{"input":[0,1],"output":[135,8]},"y":31,"width":58,"height":111},
    {"id":"right-roller","asset":"sumi/roller-right","x":{"input":[0,1],"output":[169,305]},"y":31,"width":37,"height":111},
    {"id":"wax-seal","asset":"sumi/seal","x":{"input":[0,0.15,1],"output":[153,153,293]},"y":{"input":[0,0.15,0.82,1],"output":[47,37,44,45]},"width":60,"height":73,"rotate":{"input":[0,0.15,0.8,1],"output":[0,-12,8,0]}},
  ],
  mocha: [
    {"id":"cloud-window-off","asset":"mocha/base-off","x":14,"y":57,"width":332,"height":88,"opacity":{"input":[0,1],"output":[1,0]}},
    {"id":"cloud-window-on","asset":"mocha/base","x":14,"y":57,"width":332,"height":88,"opacity":{"input":[0,1],"output":[0,1]}},
    {"id":"crescent-off","asset":"mocha/moon-off","x":{"input":[0,1],"output":[42,263]},"y":{"input":[0,0.48,1],"output":[66,14,23]},"width":80,"height":71,"opacity":{"input":[0,1],"output":[1,0]},"rotate":{"input":[0,0.48,1],"output":[-14,10,0]},"scale":{"input":[0,1],"output":[0.78,1]}},
    {"id":"crescent-on","asset":"mocha/moon","x":{"input":[0,1],"output":[42,263]},"y":{"input":[0,0.48,1],"output":[66,14,23]},"width":80,"height":71,"opacity":{"input":[0,1],"output":[0,1]},"rotate":{"input":[0,0.48,1],"output":[-14,10,0]},"scale":{"input":[0,1],"output":[0.78,1]}},
    {"id":"starlight-1","asset":"mocha/star","x":174,"y":{"input":[0,0.55,1],"output":[52,40,38]},"width":19,"height":23,"opacity":{"input":[0,0.4,1],"output":[0,0,1]},"scale":{"input":[0,1],"output":[0.4,1]}},
    {"id":"starlight-2","asset":"mocha/star","x":237,"y":{"input":[0,0.55,1],"output":[48,26,29]},"width":13,"height":15,"opacity":{"input":[0,0.55,1],"output":[0,0,0.9]}},
  ],
  street: [
    {"id":"rail-off","asset":"street/base-off","x":14,"y":52,"width":332,"height":89},
    {"id":"paint-reveal","x":14,"y":52,"width":{"input":[0,1],"output":[0,332]},"height":89,"clip":true,"children":[{"id":"painted-rail","asset":"street/base","x":0,"y":0,"width":332,"height":89}]},
    {"id":"spray-burst","asset":"street/paint","x":{"input":[0,0.25,0.7,1],"output":[53,100,252,296]},"y":{"input":[0,0.4,1],"output":[46,26,37]},"width":63,"height":30,"opacity":{"input":[0,0.18,0.36,0.8,1],"output":[0,0,0.9,0.8,0]},"scale":{"input":[0,0.45,1],"output":[0.2,1,0.75]},"rotate":-14},
    {"id":"spray-can","asset":"street/can","x":{"input":[0,1],"output":[24,291]},"y":{"input":[0,0.2,0.7,1],"output":[30,20,23,30]},"width":50,"height":83,"rotate":{"input":[0,0.16,0.78,1],"output":[0,-12,-12,0]}},
  ],
  edgerunners: [
    {"id":"module-off","asset":"edgerunners/base-off","x":10,"y":65,"width":338,"height":89,"opacity":{"input":[0,1],"output":[1,0]}},
    {"id":"module-on","asset":"edgerunners/base","x":10,"y":65,"width":338,"height":89,"opacity":{"input":[0,1],"output":[0,1]}},
    {"id":"cell-off","asset":"edgerunners/cartridge-off","x":{"input":[0,0.4,0.8,1],"output":[52,57,73,73]},"y":{"input":[0,0.35,0.86,1],"output":[15,26,84,84]},"width":121,"height":57,"opacity":{"input":[0,1],"output":[1,0]},"rotate":{"input":[0,0.35,0.8,1],"output":[-5,2,0,0]}},
    {"id":"cell-on","asset":"edgerunners/cartridge","x":{"input":[0,0.4,0.8,1],"output":[52,57,73,73]},"y":{"input":[0,0.35,0.86,1],"output":[15,26,84,84]},"width":121,"height":57,"opacity":{"input":[0,1],"output":[0,1]},"rotate":{"input":[0,0.35,0.8,1],"output":[-5,2,0,0]}},
  ],
  ghost: [
    {"id":"shrine-off","asset":"ghost/base-off","x":12,"y":41,"width":336,"height":111,"opacity":{"input":[0,1],"output":[1,0]}},
    {"id":"shrine-on","asset":"ghost/base","x":12,"y":41,"width":336,"height":111,"opacity":{"input":[0,1],"output":[0,1]}},
    {"id":"dormant-spirit","asset":"ghost/orb-off","x":140,"y":64,"width":78,"height":87,"opacity":{"input":[0,0.36,1],"output":[1,0,0]},"scale":{"input":[0,0.35,1],"output":[1,0.58,0.58]}},
    {"id":"spirit-wake","asset":"ghost/orb","x":{"input":[0,0.3,0.75,1],"output":[151,180,251,251]},"y":{"input":[0,0.42,0.8,1],"output":[66,10,15,23]},"width":89,"height":99,"opacity":{"input":[0,0.2,0.55,1],"output":[0,0,1,1]},"scale":{"input":[0,0.35,0.7,1],"output":[0.4,0.7,1.08,1]},"rotate":{"input":[0,0.6,1],"output":[-15,9,0]}},
  ],
};
