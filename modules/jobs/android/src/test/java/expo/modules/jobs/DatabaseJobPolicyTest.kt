package expo.modules.jobs

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class DatabaseJobPolicyTest {
  private fun spec() = JSONObject("""{"id":"database-test","projectId":"system-onboarding","type":"database.initialize","providerId":"provider.termux.postgresql","capabilityId":"metasploit.database","parameters":{"operation":"initialize","profileId":"termux-local"},"timeoutMs":180000}""")
  @Test fun acceptsFixedMaintenanceJobWithoutPersistingCredentials() { JobSpecPolicy.validate(spec()) }
  @Test fun rejectsCredentialAndPathParameters() {
    for (field in listOf("password", "sql", "path", "host")) {
      val request = spec()
      request.getJSONObject("parameters").put(field, "unsafe")
      assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(request) }
    }
  }
  @Test fun rejectsWrongProfileAndOperationMismatch() {
    val request = spec()
    request.getJSONObject("parameters").put("profileId", "retired-profile")
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(request) }
    val mismatch = spec().put("type", "database.stop")
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(mismatch) }
  }
  @Test fun validatesStableDatabaseOperationIdentity() {
    val request = spec()
    request.getJSONObject("parameters").put("databaseOperationId", "original-operation")
    JobSpecPolicy.validate(request)
    request.getJSONObject("parameters").put("databaseOperationId", "../other")
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(request) }
  }
  @Test fun restoreRequiresConfirmation() {
    val request = spec().put("type", "database.restore")
    request.getJSONObject("parameters").put("operation", "restore").put("backupId", "backup-1")
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(request) }
    request.getJSONObject("parameters").put("confirmReplace", true)
    JobSpecPolicy.validate(request)
  }
}
