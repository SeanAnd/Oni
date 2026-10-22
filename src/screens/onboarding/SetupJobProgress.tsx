import { Text, View } from 'react-native';
import { ActionButton } from '@/components/ActionButton';
import { useTheme } from '@/components/ThemeProvider';
import type { JobSummary } from '@/core/models/job.model';
import { setupProgressPresentation } from '@/core/models/setupPresentation.model';
import { cancelJob } from '@/core/jobs/jobClient';
import { useState } from 'react';

/** Controls for the same native job shown inside its numbered setup task. */
export function SetupJobProgress({job}: {job: JobSummary}) {
  const {colors} = useTheme();
  const view = setupProgressPresentation(job.setup);
  const [stopRequested, setStopRequested] = useState(false);
  const active = !['completed', 'failed', 'cancelled'].includes(job.status);
  return <View style={{gap:12}}>
    <Text style={{color:colors.muted}}>{active ? 'Your progress is saved. Leaving this screen does not stop installation. Return here to follow the same task.' : 'The installation job has stopped. Its result is saved with this task.'}</Text>
    {active ? <ActionButton variant="outline" label={stopRequested ? 'Stop requested — waiting for a safe point' : view.cancelLabel} disabled={stopRequested} onPress={() => {setStopRequested(true); void cancelJob(job.id).then(ok => {if (!ok) setStopRequested(false);}).catch(() => setStopRequested(false));}} /> : null}
  </View>;
}
