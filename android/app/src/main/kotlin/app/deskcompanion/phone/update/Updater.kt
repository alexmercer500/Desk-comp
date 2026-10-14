package app.deskcompanion.phone.update

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import app.deskcompanion.phone.BuildConfig
import app.deskcompanion.phone.notify.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

/**
 * Checks the releases page for a newer APK and installs it. Only builds made by
 * scripts/release.mjs know the address; any other build has [State.Off] and never goes online.
 *
 * Trust: the address is https and compiled in; the APK must match the SHA-256 in android.json,
 * be this app, newer than this one, and signed by the same key as the installed copy. Android
 * checks that last point again and shows its own "Update?" screen, so a swapped file on the
 * server still can't install.
 */
object Updater {
    sealed interface State {
        data object Off : State
        data object Idle : State
        data object Checking : State
        data object UpToDate : State
        data class Available(val info: UpdateInfo) : State
        data class Downloading(val info: UpdateInfo, val percent: Int) : State
        /** Android must first be told this app may install apps: it was sent to that setting. */
        data class NeedsPermission(val info: UpdateInfo) : State
        data class Installing(val info: UpdateInfo) : State
        data class Failed(val message: String, val info: UpdateInfo?) : State
    }

    private const val CHECK_EVERY_MS = 6L * 60 * 60 * 1000

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val _state = MutableStateFlow<State>(if (UpdateInfo.checkable(BuildConfig.UPDATE_URL)) State.Idle else State.Off)
    val state: StateFlow<State> = _state

    // https only, including after a redirect (GitHub sends downloads to its own storage host).
    private val http = OkHttpClient.Builder()
        .followSslRedirects(false)
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    val enabled get() = UpdateInfo.checkable(BuildConfig.UPDATE_URL)

    /** What the app is now, as shown in Settings. */
    fun installedName(): String = BuildConfig.VERSION_NAME

    /** Called when the app opens: checks if it has been a while. */
    fun checkIfDue(ctx: Context) {
        if (!enabled) return
        val prefs = ctx.getSharedPreferences("updates", Context.MODE_PRIVATE)
        if (System.currentTimeMillis() - prefs.getLong("checked", 0) < CHECK_EVERY_MS) return
        check(ctx, manual = false)
    }

    fun check(ctx: Context, manual: Boolean = true) {
        if (!enabled) return
        val now = _state.value
        if (now is State.Checking || now is State.Downloading || now is State.Installing) return
        val app = ctx.applicationContext
        if (manual || now !is State.Available) _state.value = State.Checking
        scope.launch {
            val prefs = app.getSharedPreferences("updates", Context.MODE_PRIVATE)
            val found = try {
                val body = fetch(BuildConfig.UPDATE_URL, 200_000).toString(Charsets.UTF_8)
                UpdateInfo.parse(body) ?: error("The update file wasn't understood")
            } catch (e: Exception) {
                _state.value = if (manual) State.Failed("Couldn't check: ${e.message ?: "no connection"}", null) else State.Idle
                return@launch
            }
            prefs.edit().putLong("checked", System.currentTimeMillis()).apply()
            if (!found.isNewerThan(installedCode(app))) {
                _state.value = State.UpToDate
                return@launch
            }
            _state.value = State.Available(found)
            // Tell them once per version, not on every check.
            if (!manual && prefs.getInt("told", 0) < found.versionCode) {
                prefs.edit().putInt("told", found.versionCode).apply()
                Notifications.updateAvailable(app, found.versionName)
            }
        }
    }

    /** Download, verify, and hand to Android's installer. Needs the "install apps" permission first. */
    fun install(ctx: Context) {
        val info = when (val s = _state.value) {
            is State.Available -> s.info
            is State.NeedsPermission -> s.info
            is State.Failed -> s.info ?: return
            else -> return
        }
        val app = ctx.applicationContext
        if (!app.packageManager.canRequestPackageInstalls()) {
            _state.value = State.NeedsPermission(info)
            ctx.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        _state.value = State.Downloading(info, 0)
        scope.launch {
            val file = File(app.cacheDir, "update/update.apk")
            try {
                file.parentFile?.mkdirs()
                file.delete()
                download(info, file)
                verify(app, info, file)
                _state.value = State.Installing(info)
                commit(app, file)
            } catch (e: Exception) {
                file.delete()
                _state.value = State.Failed(e.message ?: "The update failed", info)
            }
        }
    }

    /** Called by [InstallReceiver] with what Android decided. */
    fun installResult(ok: Boolean, message: String?) {
        val s = _state.value
        if (!ok && s is State.Installing) _state.value = State.Failed(message ?: "Android didn't install it", s.info)
    }

    /** The new version has started (the old process is gone), so the file isn't needed. */
    fun cleanUp(ctx: Context) {
        File(ctx.cacheDir, "update").deleteRecursively()
    }

    private fun installedCode(ctx: Context): Long =
        ctx.packageManager.getPackageInfo(ctx.packageName, 0).longVersionCode

    private fun fetch(url: String, limit: Int): ByteArray {
        http.newCall(Request.Builder().url(url).build()).execute().use { r ->
            check(r.isSuccessful) { "the server said ${r.code}" }
            val body = r.body ?: error("empty answer")
            val bytes = body.source().readByteArray()
            check(bytes.size <= limit) { "answer too big" }
            return bytes
        }
    }

    private fun download(info: UpdateInfo, into: File) {
        http.newCall(Request.Builder().url(info.url).build()).execute().use { r ->
            check(r.isSuccessful) { "download failed (${r.code})" }
            val body = r.body ?: error("empty download")
            val total = if (info.size > 0) info.size else body.contentLength()
            val digest = MessageDigest.getInstance("SHA-256")
            var done = 0L
            var lastPercent = -1
            body.byteStream().use { input ->
                into.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        check(done <= UpdateInfo.MAX_BYTES && (info.size == 0L || done <= info.size)) { "download is bigger than expected" }
                        digest.update(buf, 0, n)
                        out.write(buf, 0, n)
                        val percent = if (total > 0) (done * 100 / total).toInt().coerceIn(0, 100) else 0
                        if (percent != lastPercent) {
                            lastPercent = percent
                            _state.value = State.Downloading(info, percent)
                        }
                    }
                }
            }
            check(info.size == 0L || done == info.size) { "download was cut short" }
            check(UpdateInfo.hex(digest.digest()) == info.sha256) { "download doesn't match its checksum, so it was discarded" }
        }
    }

    /** The file is what android.json said, and it is this app, newer, and signed by the same key. */
    private fun verify(ctx: Context, info: UpdateInfo, file: File) {
        val pm = ctx.packageManager
        val flags = PackageManager.GET_SIGNING_CERTIFICATES
        val archive = pm.getPackageArchiveInfo(file.path, flags) ?: error("that isn't an installable app")
        check(archive.packageName == ctx.packageName) { "that file is a different app" }
        check(archive.longVersionCode == info.versionCode.toLong()) { "the file's version isn't the one announced" }
        check(archive.longVersionCode > installedCode(ctx)) { "that isn't newer than this version" }
        val theirs = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
        val mine = pm.getPackageInfo(ctx.packageName, flags).signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
        // If Android can't read the signers of a file we skip this, and its installer enforces it anyway.
        if (theirs != null && mine != null) {
            check(theirs == mine) {
                "it is signed with a different key than this copy. Uninstall this app once and install the new one, then pair again"
            }
        }
    }

    private fun commit(ctx: Context, file: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(ctx.packageName)
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("update.apk", 0, file.length()).use { out ->
                file.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            // Explicit and ours alone; mutable because Android adds the status to it.
            val result = android.app.PendingIntent.getBroadcast(
                ctx, id,
                Intent(ctx, InstallReceiver::class.java).setPackage(ctx.packageName),
                android.app.PendingIntent.FLAG_MUTABLE or android.app.PendingIntent.FLAG_UPDATE_CURRENT,
            )
            session.commit(result.intentSender)
        }
    }
}
