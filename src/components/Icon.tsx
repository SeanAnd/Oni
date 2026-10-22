import { Image } from 'react-native';
import { assets } from '@/theme/assets';
import React from 'react';
import Svg, { Path, Circle, Rect, Line, Polyline } from 'react-native-svg';
import { useTheme } from './ThemeProvider';

export type IconName = 'warning' | 'home' | 'terminal' | 'setup' | 'profile' | 'mail' | 'lock' | 'eye' | 'eyeOff' | 'arrow' | 'chevron' | 'check' | 'copy' | 'trash' | 'plus' | 'logs' | 'sessions' | 'fingerprint' | 'shield' | 'layers' | 'close' | 'pause' | 'play' | 'refresh' | 'info' | 'palette';
export function Icon({ name, size = 24, color: providedColor, strokeWidth = 1.65 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const { colors } = useTheme();
  const color = providedColor ?? colors.surfaceText;
  const common = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  let shape: React.ReactNode;
  switch (name) {
    case 'warning': shape = <><Path d="M12 3 2 21h20ZM12 9v5M12 17v1" {...common}/></>; break;
    case 'home': shape = <><Path d="M3 4 Q12 7 21 4 M4 8 H20 M7 6 V21 M17 6 V21 M5 12 H19" {...common} /></>; break;
    case 'terminal': shape = <><Polyline points="4,5 10,11 4,17" {...common}/><Line x1="13" y1="18" x2="21" y2="18" {...common}/></>; break;
    case 'profile': shape = <><Circle cx="12" cy="7" r="4" fill={color}/><Path d="M4 21v-3a8 8 0 0 1 16 0v3Z" fill={color}/></>; break;
    case 'setup': shape = <><Path d="M9 2h6l.5 3 2 1 3-.5 2 5-2.5 2v2l2 2-3 4-3-1-2 1-.5 3h-5l-.5-3-2-1-3 1-3-4 2-2v-2L1 10l2-5 3 .5 2-1Z" fill={color} transform="translate(1 0) scale(.92)"/><Circle cx="12" cy="12" r="3.6" fill={colors.surface}/></>; break;
    case 'mail': shape = <><Rect x="3" y="5" width="18" height="14" rx=".5" {...common}/><Polyline points="3,6 12,13 21,6" {...common}/></>; break;
    case 'lock': shape = <><Rect x="5" y="10" width="14" height="12" rx="1" {...common}/><Path d="M8 10V6a4 4 0 0 1 8 0v4" {...common}/><Circle cx="12" cy="15" r="1" fill={color}/><Line x1="12" y1="16" x2="12" y2="18" {...common}/></>; break;
    case 'eye': case 'eyeOff': shape = <><Path d="M2 12q10-14 20 0-10 14-20 0Z" {...common}/><Circle cx="12" cy="12" r="3" {...common}/>{name==='eyeOff'&&<Line x1="3" y1="3" x2="21" y2="21" {...common}/>}</>; break;
    case 'arrow': shape = <><Path d="M3 12h17m-7-7 7 7-7 7" {...common}/></>; break;
    case 'chevron': shape = <Polyline points="9,5 16,12 9,19" {...common}/>; break;
    case 'check': shape = <Polyline points="4,12 9,17 20,6" {...common}/>; break;
    case 'copy': shape = <><Rect x="8" y="7" width="12" height="15" rx="1" {...common}/><Path d="M15 4V2H3v16h2" {...common}/></>; break;
    case 'trash': shape = <><Path d="M3 5h18M9 5V2h6v3M6 5v16h12V5M10 9v8M14 9v8" {...common}/></>; break;
    case 'plus': shape = <Path d="M12 3v18M3 12h18" {...common}/>; break;
    case 'logs': shape = <><Path d="M5 2h9l5 5v15H5ZM14 2v6h5M8 12h8M8 16h8" {...common}/></>; break;
    case 'sessions': shape = <><Circle cx="9" cy="7" r="3" {...common}/><Path d="M2 21v-4a7 7 0 0 1 14 0v4M17 4a3 3 0 0 1 0 6M19 13q4 1 4 7" {...common}/></>; break;
    case 'fingerprint': shape = <><Path d="M4 10a8 8 0 0 1 16 0M2 8a10 10 0 0 1 20 0M7 22c-2-5-2-8-2-11a7 7 0 0 1 14 0v4M10 23c-3-5-3-9-3-12a5 5 0 0 1 10 0v5c0 2 1 4 2 5M13 22c-3-4-4-7-4-11a3 3 0 0 1 6 0v5c0 3 1 5 2 7M12 10v6c0 1 0 2 1 3" {...common}/></>; break;
    case 'shield': shape = <><Path d="M12 2 3 5v7c0 5 9 10 9 10s9-5 9-10V5Z" {...common}/><Path d="m7 12 3 3 7-7" {...common}/></>; break;
    case 'layers': shape = <><Path d="m2 7 10-5 10 5-10 5ZM2 12l10 5 10-5M2 17l10 5 10-5" {...common}/></>; break;
    case 'close': shape = <Path d="m5 5 14 14M19 5 5 19" {...common}/>; break;
    case 'pause': shape = <><Line x1="8" y1="4" x2="8" y2="20" {...common}/><Line x1="16" y1="4" x2="16" y2="20" {...common}/></>; break;
    case 'play': shape = <Path d="m6 3 15 9-15 9Z" {...common}/>; break;
    case 'palette': shape = <><Path d="M12 3a9 9 0 1 0 0 18h1.4a2.1 2.1 0 0 0 1.4-3.7 1.4 1.4 0 0 1 1-2.4H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z" {...common}/><Circle cx="7" cy="11" r="1.2" fill={color}/><Circle cx="10" cy="7" r="1.2" fill={color}/><Circle cx="15" cy="8" r="1.2" fill={color}/><Circle cx="7.5" cy="15.5" r="1.2" fill={color}/></>; break;
    case 'refresh': shape = <><Path d="M20 9A8 8 0 1 0 20 16M20 3v6h-6" {...common}/></>; break;
    default: shape = <><Circle cx="12" cy="12" r="9" {...common}/><Path d="M12 11v6M12 6v1" {...common}/></>;
  }
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>{shape}</Svg>;
}

export function PaintedIcon({ name, size = 36 }: { name: keyof typeof assets.icons; size?: number }) {
  const { colors, theme } = useTheme();
  return <Image source={assets.icons[name]} resizeMode="contain" accessible={false} style={{ width: size, height: size, tintColor: theme.treatment === 'ink' ? undefined : colors.accent }} />;
}
