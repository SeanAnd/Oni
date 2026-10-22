package expo.modules.terminal

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.termux.terminal.TerminalSession
import expo.modules.termux.TermuxRunCommandClient
import expo.modules.jobs.JobForegroundService
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** One process-wide attachment. Views and React reloads never create a shell. */
internal object TerminalRuntime {
  private val main = Handler(Looper.getMainLooper())
  private val reader = Executors.newSingleThreadScheduledExecutor()
  private val writer = ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS, ArrayBlockingQueue(64))
  private val inputLock = Any()
  private var context: Context? = null
  @Volatile private var config: JSONObject? = null
  @Volatile var state = "idle"
  @Volatile var detail = "Start a terminal session."
  @Volatile var preset = "termux"
  @Volatile private var offset = 0L
  private var sequence = 0L
  @Volatile private var inputEpoch = 0L
  @Volatile var session: TerminalSession? = null
  var changed: (() -> Unit)? = null
  @Volatile private var initialized = false
  private val callbacks = TerminalCallbacks()

  fun initialize(value: Context) {
    if (initialized) return
    initializeOnce(value)
  }
  @Synchronized private fun initializeOnce(value: Context) {
    if (initialized) return
    initialized = true; context = value.applicationContext
    try { config = TerminalSecrets(value).read()?.let { JSONObject(it) }; preset = config?.optString("preset") ?: "termux" }
    catch (_: Exception) { detail = "Saved session could not be read. Recover Termux before starting another session." }
    config?.let { state = "connecting"; makeSession(it) }
    reader.scheduleWithFixedDelay({ poll() }, 0, 120, TimeUnit.MILLISECONDS)
  }
  fun redraw() { changed?.invoke() }
  fun copyClipboard(text: String) {
    val clipboard = context?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    val clip = ClipData.newPlainText("Terminal selection", text)
    clip.description.extras = android.os.PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    clipboard.setPrimaryClip(clip)
  }
  fun pasteClipboard() {
    val clipboard = context?.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    val text = clipboard.primaryClip?.getItemAt(0)?.coerceToText(context)?.toString() ?: return
    if (text.toByteArray().size > 16000) { detail = "Paste is limited to 16 KiB."; return }
    session?.emulator?.paste(text)
  }
  private fun lease(active: Boolean) {
    try { context?.let { JobForegroundService.holdTerminal(it, active) } }
    catch (_: Exception) { if (active) detail = "Connected. Android declined the background notification; keep Oni visible." }
  }
  fun detect(): Map<String, Any> {
    val client = TermuxRunCommandClient(context!!)
    if (!client.isTermuxInstalled() || !client.hasRunCommandPermission()) return mapOf("ok" to false, "presets" to emptyList<String>())
    val result = client.runCommand("/data/data/com.termux/files/home/.rootless-workstation/bin/workstation-terminal", arrayOf("--detect"), "/data/data/com.termux/files/home", 10000)
    return try {
      val payload = JSONObject(result.stdout)
      val values = payload.optJSONArray("presets")
      mapOf("ok" to (result.errorKey == null && payload.optBoolean("ok")), "presets" to (0 until (values?.length() ?: 0)).map { values!!.getString(it) })
    } catch (_: Exception) { mapOf("ok" to false, "presets" to emptyList<String>()) }
  }
  private fun makeSession(owner: JSONObject) { main.post {
    if (config !== owner) return@post
    val initializedSession = TerminalSession(object : TerminalSession.Transport {
      override fun write(bytes: ByteArray) { input(bytes) }
      override fun resize(columns: Int, rows: Int) { enqueue(owner) {
        request(owner, JSONObject().put("operation", "resize").put("columns", columns.coerceIn(2,500)).put("rows", rows.coerceIn(2,300)))
      } }
      override fun close() { enqueue(owner) { closeSession() } }
    }, callbacks)
    // Emulator construction emits color callbacks. Keep this session private
    // until construction finishes so a mounted view cannot attach reentrantly
    // and cache a different emulator from the one receiving PTY output.
    initializedSession.updateSize(80,24,8,16)
    session = initializedSession
    redraw()
  } }
  fun summary(): Map<String, Any> = mapOf("state" to state, "detail" to detail, "preset" to preset)

  @Synchronized fun start(token: String, chosen: String): Map<String, Any> {
    require(chosen == "termux" || chosen == "kali" || chosen == "metasploit")
    if (config != null) return summary()
    val value = JSONObject().put("sessionId", UUID.randomUUID().toString()).put("grant", ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }).put("preset", chosen)
    TerminalSecrets(context!!).write(value.toString())
    config = value; preset = chosen; state = "starting"; offset = 0
    synchronized(inputLock) { sequence = 0; inputEpoch += 1 }
    val launch = JSONObject(value.toString()).put("token", token)
    val result = TermuxRunCommandClient(context!!).runCommand("/data/data/com.termux/files/home/.rootless-workstation/bin/workstation-terminal", emptyArray(), "/data/data/com.termux/files/home", 15000, launch.toString())
    val rejected = try { result.errorKey == null && !JSONObject(result.stdout).optBoolean("ok") } catch (_: Exception) { false }
    if (rejected) {
      TerminalSecrets(context!!).write(null); config = null; state = "idle"
      detail = "Terminal could not start. Update the helper or close an existing session in Termux."; return summary()
    }
    // An IPC timeout is ambiguous: keep the grant and attempt attachment, never launch twice.
    detail = "Connecting to Termux…"; state = "connecting"; makeSession(value); lease(true)
    return summary()
  }
  private fun request(owner: JSONObject, body: JSONObject): JSONObject {
    check(config === owner)
    body.put("sessionId", owner.getString("sessionId"))
    val connection = URL("http://127.0.0.1:28766/v1/terminal").openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 1500; connection.readTimeout = 3000; connection.instanceFollowRedirects = false
      connection.requestMethod = "POST"; connection.doOutput = true
      connection.setRequestProperty("Authorization", "Bearer " + owner.getString("grant"))
      connection.setRequestProperty("Content-Type", "application/json")
      connection.outputStream.use { it.write(body.toString().toByteArray()) }
      val stream = if (connection.responseCode in 200..299) connection.inputStream else connection.errorStream
      val out = java.io.ByteArrayOutputStream()
      stream.use { val chunk = ByteArray(4096); while (true) { val count = it.read(chunk); if (count < 0) break; require(out.size() + count <= 100000); out.write(chunk,0,count) } }
      val result = JSONObject(out.toString("UTF-8"))
      check(result.optBoolean("ok"))
      return result
    } finally { connection.disconnect() }
  }
  private fun poll() {
    val owner = config ?: return
    if (state == "starting" || state == "exited") return
    val currentSession = session ?: return
    val readEpoch = inputEpoch
    try {
      val result = request(owner, JSONObject().put("operation", "read").put("offset", offset))
      val bytes = Base64.decode(result.getString("data"), Base64.DEFAULT)
      val finished = !result.getBoolean("running") && result.getBoolean("drained")
      val wasConnected: Boolean
      synchronized(inputLock) {
        if (config !== owner || readEpoch != inputEpoch) return
        wasConnected = state == "running"
        if (!wasConnected) sequence = result.getLong("sequence")
        state = if (finished) "exited" else "running"
        detail = if (finished) "Session exited (code ${result.optInt("exitCode")})." else "Connected · $preset"
        offset = result.getLong("nextOffset")
      }
      if (bytes.isEmpty() && !result.optBoolean("gap") && !finished && wasConnected) return
      main.post {
        if (config !== owner || session !== currentSession) return@post
        if (result.optBoolean("gap")) { currentSession.reset(); currentSession.append("\r\n[Earlier output is no longer available]\r\n".toByteArray()) }
        if (bytes.isNotEmpty()) currentSession.append(bytes)
        if (finished) { currentSession.finished(result.optInt("exitCode")); lease(false) }
        else if (!wasConnected) lease(true)
        redraw()
      }
    } catch (_: Exception) {
      if (config === owner) disconnect("Connection lost. Input is paused; the Termux session may still be running.")
      Thread.sleep(800)
    }
  }
  private fun disconnect(message: String) = synchronized(inputLock) { inputEpoch += 1; state = "disconnected"; detail = message }
  private fun enqueue(owner: JSONObject, work: () -> Unit) {
    try { writer.execute {
      if (config !== owner) return@execute
      try { work() } catch (_: Exception) { if (config === owner) disconnect("Terminal request failed. Pending input was discarded and was not replayed.") }
    } } catch (_: java.util.concurrent.RejectedExecutionException) { disconnect("Terminal input queue is full. Pending input was discarded.") }
  }
  fun input(bytes: ByteArray) {
    val owner = config ?: return
    if (state != "running" || bytes.isEmpty()) return
    if (bytes.size > 16384) { detail = "Paste is limited to 16 KiB."; return }
    val epoch = inputEpoch
    enqueue(owner) { synchronized(inputLock) {
      if (state != "running" || epoch != inputEpoch) return@synchronized
      sequence += 1
      request(owner, JSONObject().put("operation", "write").put("sequence", sequence).put("data", Base64.encodeToString(bytes, Base64.NO_WRAP)))
    } }
  }
  @Synchronized fun closeSession(): Map<String, Any> {
    val owner = config
    try { if (owner != null) request(owner, JSONObject().put("operation", "close")) }
    catch (_: java.net.ConnectException) { /* No host listener remains. */ }
    catch (_: Exception) { detail = "Could not close the session. Recover Termux and retry."; return summary() }
    TerminalSecrets(context!!).write(null)
    synchronized(inputLock) { config = null; state = "idle"; detail = "Session closed."; offset = 0; inputEpoch += 1 }
    main.post { if (config == null) { session = null; redraw() } }; lease(false)
    return summary()
  }
}
