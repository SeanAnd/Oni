import type { OnboardingStepId } from './onboardingForm.model';
import type { SetupJobProgress } from './job.model';

const STEPS: Partial<Record<OnboardingStepId, {title: string; explanation: string; action: string}>> = {
  termux: {title: 'Connect Termux', explanation: 'Termux runs command-line programs on your phone. Oni uses it to run the tools you choose.', action: 'Check my phone'},
  kali_health: {title: 'Install your tools', explanation: 'Kali is a Linux environment containing security tools. It runs through Termux without replacing Android.', action: 'Check available tools'},
  database_initialize: {title: 'Set up saved results', explanation: 'A database keeps Metasploit’s findings organized on your phone. Oni will install it if needed.', action: 'Set up saved results'},
  database_start: {title: 'Start saved results', explanation: 'Starting the database so tools can save and read their findings.', action: 'Start database'},
  metasploit_config: {title: 'Connect your tools', explanation: 'Metasploit is a set of tools for investigating security weaknesses. Oni will connect it to your saved results.', action: 'Connect Metasploit'},
  metasploit_verify: {title: 'Check everything', explanation: 'Checking that Metasploit can connect and use its database. This does not scan other devices.', action: 'Verify and finish'},
  complete: {title: 'Your workspace is ready', explanation: 'Your tools can run and Metasploit can save results on this phone.', action: 'Open workspace'},
};
export function setupStepPresentation(step: OnboardingStepId) {
  return STEPS[step] ?? STEPS.termux!;
}
const PHASES: Record<string, string> = {
  starting: 'Preparing installation', checking: 'Checking existing tools', installing_python: 'Installing Python', checking_python: 'Checking Python',
  installing_prerequisites: 'Preparing Termux', downloading: 'Downloading Kali’s tool environment', extracting: 'Unpacking Kali', configuring_kali: 'Preparing Kali',
  installing_tools: 'Installing security tools', checking_tools: 'Checking the installed tools', ready: 'Tools are ready', checking_status: 'Checking installation status',
  interrupted: 'Installation needs checking', waiting_for_packages: 'Another installation is running', repository_unavailable: 'Package download could not finish', package_repair: 'Installed packages need checking',
};
export function setupProgressPresentation(progress?: SetupJobProgress) {
  const validBytes = progress?.phase === 'downloading' && Number.isFinite(progress.downloadedBytes) && Number.isFinite(progress.totalBytes) && progress.totalBytes! > 0 && progress.downloadedBytes! >= 0 && progress.downloadedBytes! <= progress.totalBytes!;
  return {
    title: PHASES[progress?.phase ?? 'checking_status'] ?? 'Checking installation status',
    percent: validBytes ? Math.floor(progress!.downloadedBytes! / progress!.totalBytes! * 100) : undefined,
    transfer: validBytes ? `${(progress!.downloadedBytes! / 1048576).toFixed(1)} MiB of ${(progress!.totalBytes! / 1048576).toFixed(1)} MiB` : undefined,
    cancelLabel: progress?.cancelDeferred ? 'Stop after this step' : progress?.phase === 'downloading' ? 'Stop download' : 'Stop setup',
  };
}
