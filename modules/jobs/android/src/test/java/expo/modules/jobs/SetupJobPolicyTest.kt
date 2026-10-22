package expo.modules.jobs

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SetupJobPolicyTest {
  private fun spec() = JSONObject("""{"id":"setup-test","projectId":"system-onboarding","type":"setup.python","providerId":"provider.termux.setup","capabilityId":"workstation.setup","parameters":{"catalogId":"kali-2026.2-minimal-arm64-v1"},"timeoutMs":7200000}""")
  @Test fun allowsOnlyCatalogOwnedSetupWithLongDeadline() {
    JobSpecPolicy.validate(spec())
    JobSpecPolicy.validate(spec().put("type", "setup.nethunter"))
    val injected = spec(); injected.getJSONObject("parameters").put("command", "arbitrary")
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(injected) }
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(spec().put("timeoutMs", 7200001)) }
    assertThrows(IllegalArgumentException::class.java) { JobSpecPolicy.validate(spec().put("type", "kali.health")) }
  }
}
