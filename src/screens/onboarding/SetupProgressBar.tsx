import { useReducedMotion } from '@/components/useReducedMotion';
import { useEffect, useState } from 'react';
import { Animated, View } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';

/** A moving marker means work is ongoing, never a guessed percentage. */
export function SetupProgressBar({fraction, running = false, label}: {fraction?: number; running?: boolean; label: string}) {
  const {colors, theme} = useTheme();
  const [travel] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (fraction !== undefined || !running || reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(travel, {toValue:1, duration:1400, useNativeDriver:true}),
      Animated.timing(travel, {toValue:0, duration:1400, useNativeDriver:true}),
    ]));
    animation.start();
    return () => animation.stop();
  }, [fraction, running, reduceMotion, travel]);
  const value = fraction === undefined ? undefined : Math.round(Math.max(0,Math.min(1,fraction))*100);
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={value === undefined ? {text:'Working; percentage unavailable'} : {min:0,max:100,now:value}}
    onLayout={event => setWidth(event.nativeEvent.layout.width)}
    style={{height:10, backgroundColor:colors.track, borderRadius:theme.radius.control, overflow:'hidden'}}>
    {value !== undefined ? <View style={{height:'100%',width:`${value}%`,backgroundColor:colors.accentBright}} /> : running ?
      <Animated.View style={{height:'100%',width:'30%',backgroundColor:colors.accentBright,transform:[{translateX:reduceMotion ? width*.35 : travel.interpolate({inputRange:[0,1],outputRange:[0,width*.7]})}]}} /> : null}
    <View accessible={false} style={{position:'absolute',top:0,left:0,right:0,height:2,backgroundColor:colors.background,opacity:.25}} />
  </View>;
}
