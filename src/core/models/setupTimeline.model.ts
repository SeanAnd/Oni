import type { JobSummary } from './job.model';
import type { OnboardingStepId } from './onboardingForm.model';
import type { OnboardingProgressState } from '@/core/state/onboardingProgress';
import { SETUP_TASKS, type SetupActivity, type SetupTaskId } from './setupTask.model';
import { setupProgressPresentation } from './setupPresentation.model';

/** Planning ranges, not benchmark promises or a clock-driven completion percentage.
 * Kali's broad range includes the ~19.5 minute physical installation trial. */
const TASKS: Record<SetupTaskId, {title: string; purpose: string; estimate: string; upper: number; done: string}> = {
  termux: {title:'Connect Termux & Python', purpose:'Let Oni run its helper programs on your phone.', estimate:'About 10–30 sec to check; 1–5 min if Python is needed. Permission steps are up to you.', upper:300, done:'Termux, Python and Oni’s helper are ready.'},
  kali_health: {title:'Install Kali & security tools', purpose:'Add the environment that runs Nmap and Metasploit.', estimate:'Allow about 15–35 min for a new install; 10–30 sec to check existing tools.', upper:2100, done:'Kali, Nmap and Metasploit are available; the environment check passed.'},
  database_initialize: {title:'Prepare saved results', purpose:'Create organized storage for findings, using PostgreSQL.', estimate:'About 10–60 sec if installed; allow 1–5 min for a download.', upper:300, done:'Your saved-results storage is prepared.'},
  database_start: {title:'Start the database', purpose:'Make that storage available to your tools.', estimate:'About 5–40 sec.', upper:40, done:'The managed database is running.'},
  metasploit_config: {title:'Connect Metasploit', purpose:'Tell Metasploit where to save and find its results.', estimate:'About 5–30 sec.', upper:30, done:'Metasploit’s connection settings are saved.'},
  metasploit_verify: {title:'Check everything works', purpose:'Check the real database connection and prepare its tables.', estimate:'About 20 sec–3 min. First-time table setup can take longer.', upper:180, done:'Framework connected and its database tables are ready.'},
};
const ACTIVITIES: Record<SetupActivity, string> = {
  checking_access:'Checking permission to use Termux. No tools are being installed yet.',
  checking_python:'Checking Python, which runs Oni’s helper programs.',
  installing_python:'Installing Python and the packages it needs.',
  installing_helper:'Installing Oni’s helper so the two apps can work together.',
  starting_helper:'Starting Oni’s helper and checking that it answers.',
  checking_kali:'Looking for Kali, Nmap and Metasploit already on this phone.',
  awaiting_install:'Waiting for you to choose Install missing tools.',
  installing_kali:'Preparing the Kali installation. Download and package progress will appear here.',
  checking_tools:'Checking that Kali and its tools start correctly.',
  detecting_database:'Checking whether PostgreSQL, the storage program, is already installed.',
  installing_database:'Downloading and installing PostgreSQL for your saved results.',
  initializing_database:'Preparing the place where Metasploit will save its findings.',
  starting_database:'Starting PostgreSQL and waiting for it to accept connections.',
  configuring_framework:'Saving the connection settings that Metasploit needs.',
  verifying_framework:'Starting Metasploit, checking its database connection and preparing its tables.',
};
const TYPES: Record<string, SetupTaskId> = {'setup.python':'termux','setup.nethunter':'kali_health','kali.health':'kali_health','database.install':'database_initialize','database.initialize':'database_initialize','database.start':'database_start','metasploit.prepare':'metasploit_verify'};
export function taskForSetupJob(job: JobSummary): SetupTaskId | undefined { return TYPES[job.type]; }
export function isActiveSetupJob(job: JobSummary): boolean { return !!taskForSetupJob(job) && !['completed','failed','cancelled'].includes(job.status); }
export function elapsedLabel(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  return value < 60 ? `${value} sec` : `${Math.floor(value / 60)} min ${value % 60} sec`;
}
export interface SetupTaskViewModel {
  id: SetupTaskId; number: number; title: string; purpose: string;
  state: 'pending' | 'current' | 'running' | 'attention' | 'complete';
  status: string; detail: string; estimate: string; elapsed?: string; overEstimate: boolean;
  fraction?: number; progressLabel: string; job?: JobSummary;
}
export function projectSetupTasks(input: {progress: OnboardingProgressState | null; current: OnboardingStepId; busy: boolean; jobs: JobSummary[]; now: number; error?: string; observationUnavailable?: boolean}): SetupTaskViewModel[] {
  return SETUP_TASKS.map((id, index) => {
    const definition = TASKS[id];
    const record = input.progress?.tasks?.[id];
    const job = input.jobs.find(value => taskForSetupJob(value) === id &&
      (!record || !value.startedAt || Date.parse(value.startedAt) >= record.startedAt - 5000));
    const activeJob = job && isActiveSetupJob(job) && !(record?.finishedAt && job.startedAt && Date.parse(job.startedAt) <= record.finishedAt);
    const done = !!input.progress?.completedSteps.includes(id) && !activeJob;
    const current = id === input.current || !!activeJob;
    const running = !done && (!!activeJob || current && input.busy);
    const attention = current && !done && (!!input.error || input.observationUnavailable || job?.status === 'waiting_for_device' || !input.busy && (job?.status === 'failed' || job?.status === 'cancelled'));
    const state = done ? 'complete' : attention ? 'attention' : running ? 'running' : current ? 'current' : 'pending';
    const phase = activeJob && job.setup ? setupProgressPresentation(job.setup) : undefined;
    const nativeActivity: Partial<Record<string, SetupActivity>> = {'database.install':'installing_database','database.initialize':'initializing_database','database.start':'starting_database','metasploit.prepare':'verifying_framework','kali.health':'checking_tools'};
    const activity = activeJob && nativeActivity[job.type] || record?.activity;
    const detail = done ? record?.outcome ?? definition.done
      : input.observationUnavailable && current ? 'Checking saved progress. The latest worker status could not be read; no new installation was started.'
      : job?.status === 'waiting_for_device' ? 'Waiting to reconnect to Termux. Open Termux, then return and check the saved job.'
      : current && input.error ? input.error
      : current && !input.busy && (job?.status === 'failed' || job?.status === 'cancelled') ? 'This job stopped. Completed work is kept; check the saved job before retrying.'
      : current && !input.busy && job?.status === 'completed' && job.type.startsWith('setup.') ? 'The saved installation finished. Continue to check the installed tools and finish this task.'
      : phase && (activeJob || current && input.busy) ? phase.title
      : activity && current ? (!running && activity !== 'awaiting_install' ? `Last activity: ${ACTIVITIES[activity] ?? 'Checking saved progress.'} Continue to check this task.` : ACTIVITIES[activity] ?? 'Checking saved progress.')
      : current ? 'Ready when you are. Use the action below to continue.' : definition.purpose;
    const start = record?.startedAt ?? (job?.startedAt ? Date.parse(job.startedAt) : undefined);
    const seconds = start === undefined ? undefined : Math.max(0, ((record?.finishedAt ?? input.now) - start) / 1000);
    const fraction = done ? 1 : !running ? 0 : phase?.percent !== undefined && !attention ? phase.percent / 100 : undefined;
    return {id,number:index+1,...definition,state,status:done?'Complete':attention?'Needs attention':running?'Oni is working':current?'Your next step':'Waiting for earlier tasks',detail,
      estimate: definition.estimate,elapsed:seconds === undefined ? undefined : `${done ? 'Finished in' : 'Elapsed'} ${elapsedLabel(seconds)}`,
      overEstimate:running && seconds !== undefined && seconds > definition.upper,
      fraction,progressLabel: phase?.percent !== undefined && running ? `${phase.transfer} · ${phase.percent}% of the Kali download, not the whole task` : done?'Task verified':running?'Working — completion is not yet measurable':'Not running',job};
  });
}
