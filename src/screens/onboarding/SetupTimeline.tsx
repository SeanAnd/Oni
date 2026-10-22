import { Text, View } from 'react-native';
import { useTheme } from '@/components/ThemeProvider';
import type { SetupTaskViewModel } from '@/core/models/setupTimeline.model';
import { SetupProgressBar } from './SetupProgressBar';

export function SetupTimeline({tasks}: {tasks: SetupTaskViewModel[]}) {
  const {colors, theme} = useTheme();
  const count = tasks.filter(task => task.state === 'complete').length;
  return <View style={{gap:theme.spacing.md}}>
    <Text accessibilityRole="header" style={{color:colors.text,fontSize:theme.type.title,fontFamily:theme.fonts.heading}}>Your six setup tasks</Text>
    <Text style={{color:colors.muted,fontSize:theme.type.label}}>{count} of 6 tasks verified · Each task keeps its own progress.</Text>
    <View style={{flexDirection:'row',gap:theme.spacing.xs}} accessible accessibilityLabel={`${count} of 6 setup tasks verified`}>
      {tasks.map(task => <View key={task.id} style={{flex:1,height:6,borderRadius:3,backgroundColor:task.state==='complete'?colors.accentBright:colors.track}} />)}
    </View>
    {tasks.map(task => <View key={task.id} testID={`setup-task-${task.id}`} style={{gap:theme.spacing.sm,paddingVertical:theme.spacing.md,borderBottomWidth:1,borderColor:colors.border}}>
      <View style={{flexDirection:'row',alignItems:'flex-start',gap:theme.spacing.sm}}>
        <Text style={{color:colors.accentBright,fontFamily:theme.fonts.heading,fontSize:22}}>{task.state==='complete'?'✓':String(task.number).padStart(2,'0')}</Text>
        <View style={{flex:1,gap:theme.spacing.xs}}>
          <Text accessibilityRole="header" style={{color:colors.text,fontWeight:'600',fontSize:theme.type.body}}>{task.number}. {task.title}</Text>
          <Text style={{color:task.state==='attention'?colors.danger:colors.muted,fontSize:theme.type.label}}>{task.status}{task.elapsed ? ` · ${task.elapsed}` : ''}</Text>
        </View>
      </View>
      <SetupProgressBar fraction={task.fraction} running={task.state==='running'} label={`Task ${task.number}: ${task.title}`} />
      <Text style={{color:colors.text,fontSize:theme.type.label,lineHeight:20}}>{task.detail}</Text>
      <Text style={{color:colors.muted,fontSize:theme.type.label,lineHeight:20}}>Estimate: {task.estimate}</Text>
    </View>)}
    <Text style={{color:colors.muted,fontSize:theme.type.label,lineHeight:20}}>Estimates are rough planning ranges, not countdowns. Elapsed times include pauses. Downloads and first-time setup can take longer. Completed tasks stay here so you can see what happened.</Text>
  </View>;
}
