package expo.modules.termux

import android.util.Base64
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.net.ServerSocket
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class TermuxHelperDeviceAcceptanceTest {
  @Test fun realHelperTransfersOwnedBytesAndRejectsInvalidRequests() {
    val context = InstrumentationRegistry.getInstrumentation().targetContext
    val ipc = TermuxRunCommandClient(context)
    assertTrue("Initialize Termux and grant RUN_COMMAND first", ipc.hasRunCommandPermission())
    val home = "/data/data/com.termux/files/home"
    val port = ServerSocket(0).use { it.localPort }
    val token = (UUID.randomUUID().toString() + UUID.randomUUID().toString()).replace("-", "")
    val executor = Executors.newSingleThreadExecutor()
    val server = executor.submit<TermuxResultParser.RunCompletion> {
      ipc.runCommand("$home/skid-backend/tests/fixtures/termux_helper_probe.py",
        arrayOf(port.toString()), home, 30_000, token)
    }
    try {
      val helper = TermuxHelperHttpClient(port = port)
      val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(8)
      var ready = false
      while (System.nanoTime() < deadline) {
        val response = helper.getJobStatus(token, "absent-job", "fixture-operation")
        if (response.errorKey == "JOB_NOT_FOUND") { ready = true; break }
        if (server.isDone) break
        Thread.sleep(100)
      }
      assertTrue("Disposable Termux helper failed to become reachable", ready)
      assertEquals("PERMISSION_DENIED", helper.getJobStatus("invalid", "absent-job", "fixture-operation").errorKey)
      assertEquals("JOB_NOT_FOUND", helper.cancelJob(token, "absent-job", "fixture-operation").errorKey)
      assertEquals("JOB_NOT_FOUND", helper.readArtifactChunk(token, "fixture-artifact", 0, 16, "wrong-operation").errorKey)

      val expected = ByteArray(256 * 600) { (it % 256).toByte() } + "UTF-8 boundary: € 🔐\n".toByteArray(Charsets.UTF_8)
      val expectedHash = MessageDigest.getInstance("SHA-256").digest(expected).joinToString("") { "%02x".format(it) }
      val bytes = ByteArrayOutputStream()
      var offset = 0L
      while (offset < expected.size) {
        // Recreate the client each chunk: transfer resumes from the supplied byte offset.
        val chunk = TermuxHelperHttpClient(port = port).readArtifactChunk(token, "fixture-artifact", offset, 65_536, "fixture-operation")
        assertTrue("Chunk failed: ${chunk.errorKey}", chunk.ok)
        val payload = requireNotNull(chunk.payload)
        assertEquals("fixture-artifact", payload.getString("artifactId"))
        assertEquals("fixture-operation", payload.getString("operationId"))
        assertEquals(offset, payload.getLong("offset"))
        assertEquals(expected.size.toLong(), payload.getLong("totalSize"))
        assertEquals(expectedHash, payload.getString("sha256"))
        val decoded = Base64.decode(payload.getString("dataBase64"), Base64.DEFAULT)
        assertTrue(decoded.isNotEmpty() && decoded.size <= 65_536)
        bytes.write(decoded)
        offset += decoded.size
        assertEquals(offset == expected.size.toLong(), payload.getBoolean("eof"))
      }
      assertArrayEquals(expected, bytes.toByteArray())
      val eof = helper.readArtifactChunk(token, "fixture-artifact", offset, 16, "fixture-operation")
      assertTrue(eof.ok)
      assertEquals("", eof.payload!!.getString("dataBase64"))
      assertTrue(eof.payload!!.getBoolean("eof"))

      // Exercise server validation directly, bypassing the client's local argument checks.
      for ((field, value) in listOf("offset" to -1, "limit" to 65_537, "artifactId" to "../escape")) {
        val body = JSONObject().put("artifactId", "fixture-artifact").put("operationId", "fixture-operation")
          .put("offset", 0).put("limit", 16).put(field, value)
        assertEquals("INVALID_PAYLOAD", helper.post("/v1/workstation/artifacts/chunk", token, body).errorKey)
      }
      for (artifact in listOf("missing-hash", "invalid-object", "invalid-hash")) {
        assertEquals("PARSER_FAILED", helper.readArtifactChunk(token, artifact, 0, 16, "fixture-operation").errorKey)
      }
    } finally {
      try {
        val completion = server.get(35, TimeUnit.SECONDS)
        assertNull(completion.detail, completion.errorKey)
        assertEquals(0, completion.exitCode)
        assertTrue(JSONObject(completion.stdout).getBoolean("cleanedUp"))
      } finally {
        executor.shutdownNow()
      }
    }
  }
}
