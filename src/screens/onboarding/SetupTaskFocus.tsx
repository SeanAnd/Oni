import { Text, View } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import type { SetupTaskViewModel } from '@/core/models/setupTimeline.model';
import { SetupProgressBar } from './SetupProgressBar';

export function SetupTaskFocus({task}: {task: SetupTaskViewModel}) {
  const {colors,theme} = useTheme();
  return <View style={{gap:theme.spacing.sm}}>
    <Text style={{color:colors.accentBright,fontSize:theme.type.label}}>TASK {task.number} OF 6 · {task.status}</Text>
    <Text accessibilityRole="header" style={{color:colors.text,fontSize:theme.type.title,fontFamily:theme.fonts.heading}}>{task.title}</Text>
    <Text style={{color:colors.text,fontSize:theme.type.body,lineHeight:24}}>{task.purpose}</Text>
    <Text accessibilityLiveRegion="polite" style={{color:colors.text,fontSize:theme.type.body,lineHeight:24}}>{task.detail}</Text>
    <SetupProgressBar fraction={task.fraction} running={task.state==='running'} label={`Current task: ${task.title}`} />
    <Text style={{color:colors.muted,fontSize:theme.type.label}}>{task.progressLabel}</Text>
    <Text style={{color:colors.muted,fontSize:theme.type.label,lineHeight:20}}>Estimated total: {task.estimate}</Text>
    {task.elapsed ? <Text style={{color:colors.muted,fontSize:theme.type.label}}>{task.elapsed} · Includes pauses</Text> : null}
    {task.overEstimate ? <Text style={{color:colors.text,fontSize:theme.type.label,lineHeight:20}}>More time has passed than the estimate, including any pauses. Oni is still checking the current work.</Text> : null}
  </View>;
}
