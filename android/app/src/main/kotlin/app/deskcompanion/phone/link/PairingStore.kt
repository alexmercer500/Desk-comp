package app.deskcompanion.phone.link

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The pairing (token included), kept encrypted with AES-GCM under a key that
 * lives in the Android Keystore and never leaves it. The app's data isn't
 * backed up (allowBackup=false), and anything that can't be read is wiped.
 */
object PairingStore {
    private const val ALIAS = "desk-companion-link"
    private const val PREFS = "link"

    fun save(ctx: Context, p: Pairing) {
        val json = JSONObject()
            .put("hosts", JSONArray(p.hosts))
            .put("port", p.port)
            .put("fp", p.fingerprint)
            .put("token", p.token)
            .put("name", p.name)
            .toString()
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
        val data = cipher.doFinal(json.toByteArray(Charsets.UTF_8))
        prefs(ctx).edit()
            .putString("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .putString("data", Base64.encodeToString(data, Base64.NO_WRAP))
            .apply()
    }

    fun load(ctx: Context): Pairing? {
        val p = prefs(ctx)
        val iv = p.getString("iv", null) ?: return null
        val data = p.getString("data", null) ?: return null
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply {
                init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)))
            }
            val o = JSONObject(String(cipher.doFinal(Base64.decode(data, Base64.NO_WRAP)), Charsets.UTF_8))
            val hosts = o.getJSONArray("hosts").let { a -> (0 until a.length()).map { a.getString(it) } }
            Pairing(hosts, o.getInt("port"), o.getString("fp"), o.getString("token"), o.getString("name"))
        } catch (e: Exception) {
            clear(ctx) // a key that changed or data that's damaged: start over
            null
        }
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getEntry(ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }
}
