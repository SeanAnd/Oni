package expo.modules.termux

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL

class TermuxHelperHttpClient(
  private val host: String = TermuxConstants.HELPER_HOST,
  private val port: Int = TermuxConstants.HELPER_PORT,
) {
  data class HelperResponse(
    val ok: Boolean,
    val errorKey: String?,
    val detail: String?,
    val payload: JSONObject?,
  )

  fun post(route: String, token: String, body: JSONObject): HelperResponse {
    val connection =
      (URL("http://$host:$port$route").openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 15_000
        readTimeout = 60_000
        doOutput = true
        setRequestProperty("Authorization", "Bearer $token")
        setRequestProperty("Content-Type", "application/json")
        setRequestProperty("Accept", "application/json")
      }

    return try {
      connection.instanceFollowRedirects = false
      OutputStreamWriter(connection.outputStream, Charsets.UTF_8).use { it.write(body.toString()) }
      val status = connection.responseCode
      val stream = if (status in 200..299) connection.inputStream else connection.errorStream
      val text = stream?.bufferedReader(Charsets.UTF_8)?.use { reader ->
        val buffer = CharArray(131073)
        var count = 0
        while (count < buffer.size) {
          val read = reader.read(buffer, count, buffer.size - count)
          if (read == -1) break
          count += read
        }
        require(count < buffer.size) { "Oversized helper response" }
        String(buffer, 0, count)
      } ?: ""
      val json = JSONObject(text)
      HelperResponse(status in 200..299 && json.optBoolean("ok", false),
        json.optString("errorKey", "").takeIf { it.isNotBlank() && it != "null" },
        null, json)
    } catch (_: java.io.IOException) {
      HelperResponse(false, "CAPABILITY_UNAVAILABLE", "Termux helper is unreachable.", null)
    } catch (_: Exception) {
      HelperResponse(false, "PARSER_FAILED", "Termux helper returned an invalid response.", null)
    } finally {
      connection.disconnect()
    }
  }

  fun getJobStatus(token: String, jobId: String, operationId: String): HelperResponse {
    val idError =
      TermuxResultParser.validateId(jobId, TermuxConstants.MAX_JOB_ID_LENGTH, "jobId")
        ?: TermuxResultParser.validateId(
          operationId,
          TermuxConstants.MAX_JOB_ID_LENGTH,
          "operationId",
        )
    if (idError != null) {
      return HelperResponse(false, "INVALID_PAYLOAD", idError, null)
    }
    val body =
      JSONObject()
        .put("jobId", jobId)
        .put("operationId", operationId)
    return post("${TermuxConstants.HELPER_JOBS_ROUTE}/status", token, body)
  }

  fun cancelJob(token: String, jobId: String, operationId: String): HelperResponse {
    val idError =
      TermuxResultParser.validateId(jobId, TermuxConstants.MAX_JOB_ID_LENGTH, "jobId")
        ?: TermuxResultParser.validateId(
          operationId,
          TermuxConstants.MAX_JOB_ID_LENGTH,
          "operationId",
        )
    if (idError != null) {
      return HelperResponse(false, "INVALID_PAYLOAD", idError, null)
    }
    val body =
      JSONObject()
        .put("jobId", jobId)
        .put("operationId", operationId)
    return post("${TermuxConstants.HELPER_JOBS_ROUTE}/cancel", token, body)
  }

  fun readArtifactChunk(
    token: String,
    artifactId: String,
    offset: Long,
    limit: Int,
    operationId: String,
  ): HelperResponse {
    val idError =
      TermuxResultParser.validateId(artifactId, TermuxConstants.MAX_ARTIFACT_ID_LENGTH, "artifactId")
        ?: TermuxResultParser.validateId(
          operationId,
          TermuxConstants.MAX_JOB_ID_LENGTH,
          "operationId",
        )
    if (idError != null) {
      return HelperResponse(false, "INVALID_PAYLOAD", idError, null)
    }
    if (offset < 0) {
      return HelperResponse(false, "INVALID_PAYLOAD", "offset must be non-negative", null)
    }
    if (limit <= 0 || limit > TermuxConstants.MAX_CHUNK_BYTES) {
      return HelperResponse(
        false,
        "INVALID_PAYLOAD",
        "limit must be between 1 and ${TermuxConstants.MAX_CHUNK_BYTES}",
        null,
      )
    }
    val body =
      JSONObject()
        .put("artifactId", artifactId)
        .put("offset", offset)
        .put("limit", limit)
        .put("operationId", operationId)
    return post("${TermuxConstants.HELPER_ARTIFACTS_ROUTE}/chunk", token, body)
  }
}
