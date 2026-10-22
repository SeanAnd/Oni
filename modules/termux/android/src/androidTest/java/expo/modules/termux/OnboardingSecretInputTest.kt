package expo.modules.termux

import android.os.Bundle
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Explicitly invoked acceptance action; secrets never enter shell argv or test output. */
@RunWith(AndroidJUnit4::class)
class OnboardingSecretInputTest {
  @Test fun fillCurrentSecretField() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val input = File(instrumentation.targetContext.filesDir, "skid-acceptance-secret.json")
    assumeTrue("Explicit private onboarding input is required", input.isFile)
    val request = try { JSONObject(input.readText()) } finally { input.delete() }
    val label = request.getString("label")
    require(label in setOf("Termux helper token", "Metasploit database password"))
    val value = request.getString("value")
    require(value.isNotEmpty() && value.length <= 512)
    val deadline = SystemClock.elapsedRealtime() + 10_000
    while (SystemClock.elapsedRealtime() < deadline) {
      val root = instrumentation.uiAutomation.rootInActiveWindow
      if (root?.packageName?.toString() == "com.skid.workstation") {
        val field = findField(root, label)
        if (field != null) {
          val arguments = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value)
          }
          assertTrue("Unable to populate onboarding field", field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments))
          return
        }
      }
      SystemClock.sleep(100)
    }
    throw AssertionError("Expected onboarding field is not visible in SKID")
  }

  private fun findField(node: AccessibilityNodeInfo, label: String): AccessibilityNodeInfo? {
    if (node.contentDescription?.toString() == label && node.isEditable) return node
    for (index in 0 until node.childCount) {
      val child = node.getChild(index) ?: continue
      findField(child, label)?.let { return it }
    }
    return null
  }
}
