package app.deskcompanion.phone.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.deskcompanion.phone.MainActivity
import app.deskcompanion.phone.R
import app.deskcompanion.phone.model.Approval
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Settings
import app.deskcompanion.phone.model.Status

/**
 * The app's notifications: a request waiting for you (Deny right there, Allow
 * in the app), a task that finished or failed, and the quiet one that keeps
 * the link alive.
 */
object Notifications {
    const val CHANNEL_APPROVALS = "approvals"
    const val CHANNEL_UPDATES = "updates"
    const val CHANNEL_LINK = "link"
    const val ACTION_DENY = "app.deskcompanion.phone.DENY"
    const val EXTRA_ID = "id"
    const val EXTRA_RID = "rid"
    /** When the notification was posted: a Deny tap in the first moments is ignored (see ActionReceiver). */
    const val EXTRA_AT = "at"
    const val GUARD_MS = 600L
    /** Opens the app on this request's sheet. Only ever selects what to show: opening the app decides nothing. */
    const val EXTRA_REVIEW = "review"
    const val LINK_ID = 1
    private const val TEST_ID = 1001

    /** Requests with a notification up, so each is posted once and removed when it's gone. */
    private val posted = mutableSetOf<String>()

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_APPROVALS, "Approvals", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "An agent is waiting for your OK"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 400, 120, 400)
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_UPDATES, "Updates", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "A task finished, or failed"
            },
        )
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL_LINK, "Link to your PC", NotificationManager.IMPORTANCE_MIN).apply {
                description = "Shown while the app keeps the link to your computer"
                setShowBadge(false)
            },
        )
    }

    fun canPost(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun linkOngoing(ctx: Context): Notification =
        NotificationCompat.Builder(ctx, CHANNEL_LINK)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Linked to your PC")
            .setContentText("Watching your coding agents")
            .setOngoing(true)
            .setSilent(true)
            .setContentIntent(openApp(ctx, null))
            .build()

    /**
     * Posts what changed between two session lists: new requests, tasks that
     * finished or failed. Removes notifications for requests that are gone
     * (answered anywhere, timed out). Returns the ids of new requests.
     */
    fun onSessions(ctx: Context, before: List<Session>, now: List<Session>): List<String> {
        val nm = NotificationManagerCompat.from(ctx)
        val waiting = now.mapNotNull { s -> s.approval?.takeIf { it.rid.isNotEmpty() }?.let { s to it } }
        val fresh = waiting.filter { (_, a) -> a.rid !in posted }
        val stillThere = waiting.map { it.second.rid }.toSet()
        synchronized(posted) {
            for (rid in posted.filter { it !in stillThere }) {
                nm.cancel(idFor(rid))
                posted.remove(rid)
            }
        }
        if (!canPost(ctx)) return fresh.map { it.second.rid }
        val settings = Settings.shared
        for ((s, a) in fresh) {
            // Switched off: still in the app, just no ping. Requests are urgent, so quiet hours don't hold them back.
            if (settings.notifyNeedsYou) nm.notify(idFor(a.rid), approval(ctx, s, a))
            synchronized(posted) { posted.add(a.rid) }
        }
        val quiet = settings.quietHours && Settings.isQuiet(java.time.LocalTime.now().hour)
        for (s in now) {
            val was = before.firstOrNull { it.id == s.id }?.status ?: continue
            val busy = was == Status.Working || was == Status.Waiting
            val wanted = when (s.status) {
                Status.Done -> settings.notifyDone
                Status.Error -> settings.notifyErrors
                else -> false
            }
            if (busy && wanted && !quiet) {
                nm.notify(idFor("end:${s.id}"), ended(ctx, s))
            }
        }
        return fresh.map { it.second.rid }
    }

    /** Removes everything the link posted (unpaired, or the PC unlinked this phone). */
    fun clearLink(ctx: Context) {
        val nm = NotificationManagerCompat.from(ctx)
        synchronized(posted) {
            for (rid in posted) nm.cancel(idFor(rid))
            posted.clear()
        }
    }

    fun cancelRequest(ctx: Context, rid: String) {
        NotificationManagerCompat.from(ctx).cancel(idFor(rid))
    }

    private fun idFor(key: String) = 10_000 + (key.hashCode() and 0x3fffffff)

    private fun openApp(ctx: Context, review: String?): PendingIntent {
        val intent = Intent(ctx, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        if (review != null) intent.putExtra(EXTRA_REVIEW, review)
        return PendingIntent.getActivity(ctx, (review ?: "").hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /**
     * A request. The lock screen shows only that an approval is needed, never
     * the command. Deny works without unlocking; Allow opens the app.
     */
    private fun approval(ctx: Context, s: Session, a: Approval): Notification {
        val id = idFor(a.rid)
        val deny = PendingIntent.getBroadcast(
            ctx, id,
            Intent(ctx, ActionReceiver::class.java).setAction(ACTION_DENY).putExtra(EXTRA_ID, id).putExtra(EXTRA_RID, a.rid)
                .putExtra(EXTRA_AT, System.currentTimeMillis()),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val open = openApp(ctx, a.rid)
        val lockScreen = NotificationCompat.Builder(ctx, CHANNEL_APPROVALS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Approval needed")
            .setContentText("Unlock to see the request")
            .build()
        val what = "${s.agent} wants to ${a.action}"
        return NotificationCompat.Builder(ctx, CHANNEL_APPROVALS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("${s.project} needs your OK")
            .setContentText(what)
            .setStyle(NotificationCompat.BigTextStyle().bigText(if (a.detail.isNotEmpty()) "$what:\n${a.detail.take(400)}" else what))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(lockScreen)
            .setColor(0xFF9FB6FA.toInt())
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Deny", deny)
            .addAction(0, "Allow", open)
            // The PC gives up waiting after about two minutes.
            .setTimeoutAfter(120_000)
            .build()
    }

    private fun ended(ctx: Context, s: Session): Notification {
        val ok = s.status == Status.Done
        return NotificationCompat.Builder(ctx, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(if (ok) "${s.project} is done" else "${s.project} stopped")
            .setContentText(s.line)
            .setStyle(NotificationCompat.BigTextStyle().bigText(s.summary ?: s.line))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setColor(0xFF9FB6FA.toInt())
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, null))
            .build()
    }

    /** The sample approval from Settings → Try it. */
    fun showTestApproval(ctx: Context) {
        if (!canPost(ctx)) return
        val sample = Session(id = "test", agent = "Claude Code", project = "shop-app", status = Status.Waiting, line = "")
        val n = approval(ctx, sample, Approval(rid = "", tool = "Bash", action = "run", detail = "npm test -- --coverage"))
        NotificationManagerCompat.from(ctx).notify(TEST_ID, n)
    }
}
