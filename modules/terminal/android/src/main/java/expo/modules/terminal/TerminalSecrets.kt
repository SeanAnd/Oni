package expo.modules.terminal
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.security.KeyStore
/** Private resume grant; terminal content and input are never persisted. */
internal class TerminalSecrets(context: Context) {
  private val prefs = context.getSharedPreferences("oni-terminal", Context.MODE_PRIVATE)
  private fun key(): SecretKey {
    val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey("oni-terminal",null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("oni-terminal",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
  }
  fun write(value: String?) {
    if(value==null) { check(prefs.edit().clear().commit());return }
    val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key())
    check(prefs.edit().putString("state",Base64.encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()),Base64.NO_WRAP)).commit())
  }
  fun read(): String? = prefs.getString("state",null)?.let {
    val bytes=Base64.decode(it,Base64.NO_WRAP);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))
    String(cipher.doFinal(bytes.copyOfRange(12,bytes.size)))
  }
}
