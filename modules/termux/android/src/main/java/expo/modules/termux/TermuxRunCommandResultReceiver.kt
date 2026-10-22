package expo.modules.termux

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Receives Termux RUN_COMMAND PendingIntent completion envelopes. */
class TermuxRunCommandResultReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val session = TermuxRunCommandSession.consumePending(intent) ?: return
    val client = TermuxRunCommandClient(context.applicationContext)
    val completion = client.parseResultIntent(intent)
    TermuxRunCommandSession.complete(session, completion)
  }
}
