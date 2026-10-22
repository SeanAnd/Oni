package expo.modules.termux

import android.content.Context
import android.app.Application
import android.content.pm.PackageInfo
import android.content.Intent
import android.os.Bundle
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class TermuxIntentContractTest {
  private val context = ApplicationProvider.getApplicationContext<Context>()
  @Test fun backgroundCommandsSuppressTermuxStdinLogging() {
    shadowOf(context.packageManager).installPackage(PackageInfo().apply { packageName = "com.termux" })
    val application = shadowOf(context as Application)
    application.grantPermissions("com.termux.permission.RUN_COMMAND")
    TermuxRunCommandClient(context).runCommand("/fixture.py", emptyArray(), null, 1_000, "private fixture")
    val intent = application.nextStartedService
    assertNotNull(intent)
    assertEquals("0", intent.getStringExtra(TermuxConstants.EXTRA_COMMAND_BACKGROUND_CUSTOM_LOG_LEVEL))
    assertTrue(intent.getBooleanExtra(TermuxConstants.EXTRA_COMMAND_BACKGROUND, false))
  }
  @Test fun pythonFreeBootstrapUsesBashAndOnlyPackagedSource() {
    shadowOf(context.packageManager).installPackage(PackageInfo().apply { packageName = "com.termux" })
    val application = shadowOf(context as Application)
    application.grantPermissions("com.termux.permission.RUN_COMMAND")
    val thread = Thread { TermuxRunCommandClient(context).runBootstrap("probe", "probe") }
    thread.start()
    var intent: Intent? = null
    for (attempt in 0..100) {
      intent = application.nextStartedService
      if (intent != null) break
      Thread.sleep(20)
    }
    assertNotNull(intent)
    assertEquals("/data/data/com.termux/files/usr/bin/bash", intent!!.getStringExtra(TermuxConstants.EXTRA_COMMAND_PATH))
    assertTrue(String(android.util.Base64.decode(intent.getStringExtra("com.termux.RUN_COMMAND_STDIN")!!, android.util.Base64.DEFAULT)).contains("python_ready()"))
    assertEquals("probe", intent.getStringArrayExtra(TermuxConstants.EXTRA_COMMAND_ARGUMENTS)!!.last())
    thread.interrupt(); thread.join(1000)
    assertThrows(IllegalArgumentException::class.java) { TermuxRunCommandClient(context).runBootstrap("exec", "probe") }
  }
  @Test fun readsOfficialNestedResultBundle() {
    val bundle = Bundle().apply {
      putInt("err", -1); putInt("exitCode", 0)
      putString("stdout", "{\"ok\":true}"); putString("stderr", "")
      putString("stdout_original_length", "11")
    }
    val result = TermuxRunCommandClient(context).parseResultIntent(Intent().putExtra("result", bundle))
    assertNull(result.errorKey)
    assertEquals(0, result.exitCode)
    assertEquals("{\"ok\":true}", result.stdout)
  }
  @Test fun rejectsAbsentBundleAndExitCode() {
    val client = TermuxRunCommandClient(context)
    assertEquals("PARSER_FAILED", client.parseResultIntent(Intent().putExtra("stdout", "ok")).errorKey)
    assertEquals("PARSER_FAILED", client.parseResultIntent(Intent().putExtra("result", Bundle())).errorKey)
  }
  @Test fun rejectsTruncatedEnvelope() {
    val bundle = Bundle().apply { putInt("exitCode", 0); putString("stdout", "{}"); putString("stdout_original_length", "10000") }
    assertEquals("PARSER_FAILED", TermuxRunCommandClient(context).parseResultIntent(Intent().putExtra("result", bundle)).errorKey)
  }
  @Test fun readsIntegerErrorCodeAndMessage() {
    val bundle = Bundle().apply { putInt("err", 1); putString("errmsg", "Permission denied") }
    assertNotNull(TermuxRunCommandClient(context).parseResultIntent(Intent().putExtra("result", bundle)).errorKey)
  }
  @Test fun timedOutSessionCanBeRemovedAndLateCallbackIsIgnored() {
    val session = TermuxRunCommandSession.register("request")
    assertEquals("JOB_TIMEOUT", TermuxRunCommandSession.await(session, 1).errorKey)
    TermuxRunCommandSession.remove("request")
    assertNull(TermuxRunCommandSession.consumePending(Intent().putExtra(TermuxRunCommandSession.EXTRA_REQUEST_ID, "request")))
  }
}
