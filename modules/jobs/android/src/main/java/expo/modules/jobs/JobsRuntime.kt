package expo.modules.jobs

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Application-owned runtime: foreground service must never depend on a React module. */
class JobsRuntime private constructor(context: Context) {
  val store = JobLedgerStore(context.applicationContext)
  private val tokenStore = HelperTokenStore(context.applicationContext)
  val runner = JobExecutionRunner(context.applicationContext, store) { tokenStore.read() }
  @Volatile var onUpdate: ((String) -> Unit)? = null
  init { store.onUpdate = { id ->
    try { onUpdate?.invoke(id) } catch (_: Exception) { /* UI detachment cannot roll back native job state. */ }
  } }
  fun configureToken(token: String?) = tokenStore.write(token)

  companion object {
    @Volatile private var instance: JobsRuntime? = null
    fun get(context: Context): JobsRuntime = instance ?: synchronized(this) {
      instance ?: JobsRuntime(context).also { instance = it }
    }
  }
}

/** Only encrypted token bytes are persisted; the wrapping key never leaves Android Keystore. */
internal class HelperTokenStore(context: Context) {
  private val preferences = context.getSharedPreferences("skid_job_secrets", Context.MODE_PRIVATE)
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey("skid-job-helper", null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("skid-job-helper", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  @Synchronized fun write(token: String?) {
    if (token.isNullOrBlank()) { preferences.edit().clear().commit(); return }
    require(token.length <= 512 && token.all { it.code in 33..126 })
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val bytes = cipher.doFinal(token.toByteArray(Charsets.UTF_8))
    check(preferences.edit().putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
      .putString("value", Base64.encodeToString(bytes, Base64.NO_WRAP)).commit())
  }
  @Synchronized fun read(): String? = try {
    val iv = preferences.getString("iv", null)
    val value = preferences.getString("value", null)
    if (iv == null || value == null) null else {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
        init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
      }
      String(cipher.doFinal(Base64.decode(value, Base64.NO_WRAP)), Charsets.UTF_8)
    }
  } catch (_: Exception) { null }
}
