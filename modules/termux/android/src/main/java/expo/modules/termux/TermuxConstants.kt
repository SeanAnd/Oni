package expo.modules.termux

object TermuxConstants {
  const val TERMUX_PACKAGE = "com.termux"
  const val RUN_COMMAND_SERVICE = "com.termux.app.RunCommandService"
  const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"

  const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
  const val EXTRA_COMMAND_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
  const val EXTRA_COMMAND_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
  const val EXTRA_COMMAND_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
  const val EXTRA_COMMAND_BACKGROUND_CUSTOM_LOG_LEVEL = "com.termux.RUN_COMMAND_BACKGROUND_CUSTOM_LOG_LEVEL"
  const val EXTRA_COMMAND_SESSION_ACTION = "com.termux.RUN_COMMAND_SESSION_ACTION"
  const val EXTRA_COMMAND_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT"

  const val EXTRA_RESULT = "result"
  const val EXTRA_RESULT_STDOUT = "stdout"
  const val EXTRA_RESULT_STDERR = "stderr"
  const val EXTRA_RESULT_EXIT_CODE = "exitCode"
  const val EXTRA_RESULT_ERR = "err"

  /** Default path to bash inside Termux when the home prefix is standard. */
  const val DEFAULT_BASH_PATH = "/data/data/com.termux/files/usr/bin/bash"

  const val WORKSTATION_HOME = ".rootless-workstation"
  const val HEALTH_SCRIPT = "bin/workstation-health"
  const val RUN_SCRIPT = "bin/workstation-run"
  const val MSF_CONFIG_SCRIPT = "bin/workstation-msf-config"
  const val MSF_VERIFY_SCRIPT = "bin/workstation-msf-verify"
  const val MSF_CONSOLE_LAUNCH_SCRIPT = "bin/workstation-msf-console-launch"

  const val HELPER_HOST = "127.0.0.1"
  const val HELPER_PORT = 28765
  const val HELPER_JOBS_ROUTE = "/v1/workstation/jobs"
  const val HELPER_ARTIFACTS_ROUTE = "/v1/workstation/artifacts"

  const val MAX_JOB_ID_LENGTH = 128
  const val MAX_ARTIFACT_ID_LENGTH = 128
  const val MAX_CHUNK_BYTES = 65536
  const val DEFAULT_TIMEOUT_MS = 120_000L
}
