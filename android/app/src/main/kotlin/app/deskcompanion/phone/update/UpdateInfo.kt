package app.deskcompanion.phone.update

import org.json.JSONObject
import java.security.MessageDigest

/**
 * What `android.json` says about the newest release. Parsed strictly: an address that isn't https
 * or a hash that isn't 64 hex digits makes the whole file be ignored, not partly trusted.
 */
data class UpdateInfo(
    val versionCode: Int,
    val versionName: String,
    val url: String,
    /** SHA-256 of the APK, lower-case hex. */
    val sha256: String,
    val size: Long,
    val notes: String,
) {
    companion object {
        /** The biggest APK we will download (the real one is about 6 MB). */
        const val MAX_BYTES = 120L * 1024 * 1024

        fun parse(text: String): UpdateInfo? = try {
            val j = JSONObject(text)
            val info = UpdateInfo(
                versionCode = j.getInt("versionCode"),
                versionName = j.getString("versionName").take(40),
                url = j.getString("url"),
                sha256 = j.getString("sha256").lowercase(),
                size = j.optLong("size", 0),
                notes = j.optString("notes", "").take(2000),
            )
            info.takeIf {
                it.versionCode > 0 &&
                    it.url.startsWith("https://") &&
                    Regex("[0-9a-f]{64}").matches(it.sha256) &&
                    it.size in 0..MAX_BYTES
            }
        } catch (_: Exception) {
            null
        }

        /** The address of android.json must be https too (empty means this build doesn't update). */
        fun checkable(address: String) = address.startsWith("https://")

        fun sha256(bytes: ByteArray): String = hex(MessageDigest.getInstance("SHA-256").digest(bytes))

        fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }
    }

    fun isNewerThan(installedCode: Long) = versionCode > installedCode
}
