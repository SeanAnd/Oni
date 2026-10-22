package expo.modules.jobs

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.util.concurrent.Executors

class JobForegroundService : Service() {
  private val executor = Executors.newSingleThreadExecutor()
  private val cancellations = Executors.newSingleThreadExecutor()
  private val scheduled = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
  private val discovery = java.util.concurrent.Executors.newSingleThreadScheduledExecutor()
  @Volatile private var closingTerminal = false

  override fun onCreate() {
    super.onCreate()
    discovery.scheduleWithFixedDelay({
      try {
        val runtime = JobsRuntime.get(applicationContext)
        for (id in runtime.runner.importMsfdbJobs()) schedule(runtime, id)
      } catch (_: Exception) { /* Offline helper does not affect active native work. */ }
    }, 0, 3, java.util.concurrent.TimeUnit.SECONDS)
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val runtime = JobsRuntime.get(applicationContext)
    ensureChannel()
    if (intent?.action == ACTION_TERMINAL) terminalActive = intent.getBooleanExtra("active", false)
    val displayJob = intent?.getStringExtra(EXTRA_JOB_ID) ?: scheduled.firstOrNull()
    startForeground(NOTIFICATION_ID, buildNotification(displayJob, true))
    if (intent?.action == ACTION_TERMINAL) {
      terminalActive = intent.getBooleanExtra("active", false)
      if (terminalActive) stopWhenIdle() else {
        // Transfer any just-submitted CLI work before releasing the terminal lease.
        closingTerminal = true
        discovery.execute {
          try {
            for (id in runtime.runner.importMsfdbJobs()) schedule(runtime, id)
          } finally {
            closingTerminal = false
            stopWhenIdle()
          }
        }
      }
    } else if (intent?.action == ACTION_CANCEL) {
      intent.getStringExtra(EXTRA_JOB_ID)?.let { id ->
        cancellations.execute {
          try { runtime.runner.requestCancel(id) } finally { stopWhenIdle() }
        }
      }
    } else {
      val requested = intent?.getStringExtra(EXTRA_JOB_ID)
      val ids = if (requested != null) listOf(requested) else runtime.store.listActiveJobs().map { it.id }
      for (id in ids) schedule(runtime, id)
      if (ids.isEmpty() && !terminalActive && !closingTerminal) stopSelfResult(startId)
    }
    return START_STICKY
  }

  private fun schedule(runtime: JobsRuntime, id: String) {
    if (!scheduled.add(id)) return
    executor.execute {
      try { runtime.runner.execute(id) } finally {
        scheduled.remove(id)
        stopWhenIdle()
      }
    }
  }

  private fun stopWhenIdle() {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      if (scheduled.isEmpty() && !terminalActive && !closingTerminal) stopSelf()
      else updateNotification(scheduled.firstOrNull(), true)
    }
  }

  override fun onDestroy() {
    discovery.shutdownNow()
    executor.shutdown()
    cancellations.shutdown()
    super.onDestroy()
  }

  private fun updateNotification(jobId: String?, running: Boolean) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.notify(NOTIFICATION_ID, buildNotification(jobId, running))
  }

  private fun buildNotification(jobId: String?, running: Boolean): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    if (jobId == null) return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(if (terminalActive) "Oni terminal active" else "Oni workstation")
      .setContentText(if (terminalActive) "Tap to return to your terminal. Close the session in Oni when finished." else "Recovering workstation jobs…")
      .setContentIntent(open).setSmallIcon(android.R.drawable.stat_sys_download_done).setOngoing(true).build()
    val cancelIntent =
      Intent(this, JobForegroundService::class.java).apply {
        action = ACTION_CANCEL
        putExtra(EXTRA_JOB_ID, jobId)
      }
    val cancelPending =
      PendingIntent.getService(
        this,
        jobId.hashCode(),
        cancelIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    val setup = JobsRuntime.get(applicationContext).store.getJob(jobId)?.type?.startsWith("setup.") == true
    val title = if (setup) "Oni is installing tools" else if (running) "Oni job running" else "Oni job finished"
    val text = if (setup) "Your progress is saved. Tap to check installation." else if (running) "Job $jobId" else "Job $jobId complete"
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentIntent(open)
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_download_done)
      .setOngoing(running)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, if (setup) "Stop after this step" else "Cancel", cancelPending)
      .build()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
      return
    }
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channel =
      NotificationChannel(CHANNEL_ID, "Oni Jobs", NotificationManager.IMPORTANCE_LOW).apply {
        description = "Foreground execution for Oni workstation jobs"
        setShowBadge(false)
      }
    manager.createNotificationChannel(channel)
  }

  companion object {
    @Volatile private var terminalActive=false
    const val ACTION_TERMINAL="expo.modules.jobs.action.TERMINAL"
    fun holdTerminal(context:Context,active:Boolean) {
      if (terminalActive == active) return
      val intent=Intent(context,JobForegroundService::class.java).setAction(ACTION_TERMINAL).putExtra("active",active)
      if(android.os.Build.VERSION.SDK_INT>=26)context.startForegroundService(intent) else context.startService(intent)
    }
    const val CHANNEL_ID = "skid_jobs"
    const val NOTIFICATION_ID = 28765
    const val EXTRA_JOB_ID = "jobId"
    const val ACTION_START_JOB = "expo.modules.jobs.action.START_JOB"
    const val ACTION_CANCEL = "expo.modules.jobs.action.CANCEL"

    fun startJob(context: Context, jobId: String) {
      val intent =
        Intent(context, JobForegroundService::class.java).apply {
          action = ACTION_START_JOB
          putExtra(EXTRA_JOB_ID, jobId)
        }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }
  }
}
