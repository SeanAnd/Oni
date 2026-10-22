import { projectSetupTasks } from './setupTimeline.model';
import { SETUP_TASKS } from './setupTask.model';
import type { JobSummary } from './job.model';

const base = {progress:{completedSteps:[],onboardingComplete:false},current:'kali_health' as const,busy:false,jobs:[],now:100000};
const download: JobSummary = {id:'kali-job',projectId:'system-onboarding',type:'setup.nethunter',providerId:'provider.termux.setup',capabilityId:'workstation.setup',status:'running',startedAt:new Date(1000).toISOString(),artifactIds:[],setup:{phase:'downloading',downloadedBytes:50,totalBytes:100}};
it('shows exactly six numbered tasks with a planning estimate for every task', () => {
  const tasks=projectSetupTasks(base);
  expect(tasks.map(task=>task.id)).toEqual(SETUP_TASKS);
  expect(tasks.map(task=>task.number)).toEqual([1,2,3,4,5,6]);
  expect(tasks.every(task=>task.estimate.length>10)).toBe(true);
  expect(tasks[1].title).toContain('Kali');
});
it('puts a background Kali download in task 2 even when the screen was on another task', () => {
  const tasks=projectSetupTasks({...base,current:'termux',jobs:[download]});
  expect(tasks[1].state).toBe('running');
  expect(tasks[1].fraction).toBe(.5);
  expect(tasks[1].detail).toContain('Downloading Kali');
  expect(tasks[1].progressLabel).toContain('not the whole task');
  expect(tasks.filter(task=>task.state==='complete')).toHaveLength(0);
});
it('a full download never completes the installation or makes package progress determinate', () => {
  const tasks=projectSetupTasks({...base,jobs:[{...download,setup:{phase:'installing_tools',downloadedBytes:100,totalBytes:100}}]});
  expect(tasks[1].state).toBe('running');
  expect(tasks[1].fraction).toBeUndefined();
  expect(tasks[1].detail).toContain('Installing security tools');
});
it('retains completion outcomes and measured durations through later rapid steps', () => {
  const tasks=projectSetupTasks({...base,current:'metasploit_verify',busy:true,progress:{completedSteps:['database_initialize','database_start'],onboardingComplete:false,tasks:{database_initialize:{startedAt:1000,finishedAt:4000,activity:'initializing_database',outcome:'PostgreSQL was already available.'}}}});
  expect(tasks[2].state).toBe('complete');
  expect(tasks[2].detail).toBe('PostgreSQL was already available.');
  expect(tasks[2].elapsed).toBe('Finished in 3 sec');
  expect(tasks[2].fraction).toBe(1);
});
it('a stale worker status becomes attention, never success or a made-up network failure', () => {
  const task=projectSetupTasks({...base,jobs:[download],observationUnavailable:true})[1];
  expect(task.state).toBe('attention');
  expect(task.detail).toContain('could not be read');
  expect(task.fraction).not.toBe(1);
});
it('does not call an overdue estimate complete or count down to zero', () => {
  const task=projectSetupTasks({...base,current:'database_start',busy:true,progress:{completedSteps:[],onboardingComplete:false,tasks:{database_start:{startedAt:0,activity:'starting_database'}}}})[3];
  expect(task.overEstimate).toBe(true);
  expect(task.state).toBe('running');
  expect(task.fraction).toBeUndefined();
});
it('finished installer output cannot hide the helper connection or final tool check', () => {
  const task=projectSetupTasks({...base,busy:true,jobs:[{...download,status:'completed',setup:{phase:'ready'}}],progress:{completedSteps:[],onboardingComplete:false,tasks:{kali_health:{startedAt:1000,activity:'checking_tools'}}}})[1];
  expect(task.detail).toContain('start correctly');
  expect(task.state).toBe('running');
});

it('explains a background installation finished without claiming the whole task is verified', () => {
  const task=projectSetupTasks({...base,jobs:[{...download,status:'completed',setup:{phase:'ready'}}],progress:{completedSteps:[],onboardingComplete:false,tasks:{kali_health:{startedAt:1000,activity:'installing_kali'}}}})[1];
  expect(task.state).toBe('current');
  expect(task.detail).toContain('saved installation finished');
  expect(task.detail).toContain('Continue to check');
});
