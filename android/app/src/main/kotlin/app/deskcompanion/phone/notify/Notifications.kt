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
import androidx.core.app.RemoteInput
import androidx.core.content.ContextCompat
import app.deskcompanion.phone.MainActivity
import app.deskcompanion.phone.R
import app.deskcompanion.phone.model.Approval
import app.deskcompanion.phone.model.Question
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Settings
import app.deskcompanion.phone.model.Status

/**
 * The app's notifications: a request waiting for you (Deny right there, Allow
 * in the app), a question (answered in the app), a task that finished or
 * failed (with Reply while the PC holds it for one), and the quiet one that
 * keeps the link alive.
 */
object Notifications {
    const val CHANNEL_APPROVALS = "approvals"
    const val CHANNEL_UPDATES = "updates"
    const val CHANNEL_LINK = "link"
    const val ACTION_DENY = "app.deskcompanion.phone.DENY"
    const val ACTION_REPLY = "app.deskcompanion.phone.REPLY"
    const val KEY_REPLY = "reply"
    const val EXTRA_ID = "id"
    const val EXTRA_RID = "rid"
    /** When the notification was posted: a Deny tap in the first moments is ignored (see ActionReceiver). */
    const val EXTRA_AT = "at"
    const val GUARD_MS = 600L
    /** Opens the app on this request's sheet. Only ever selects what to show: opening the app decides nothing. */
    const val EXTRA_REVIEW = "review"
    const val LINK_ID = 1
    private const val TEST_ID = 1001
    private const val UPDATE_ID = 1002

    /** Requests and questions with a notification up, so each is posted once and removed when it's gone. */
    private val posted = mutableSetOf<String>()
    /** Turns held for a reply whose notification offers Reply: hold id → session id. */
    private val replying = mutableMapOf<String, String>()

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
     * Posts what changed between two session lists: new requests and
     * questions, tasks that finished or failed, turns held for a reply.
     * Removes notifications for requests that are gone (answered anywhere,
     * timed out) and takes Reply off a turn no longer held. Returns the ids of
     * new requests and questions.
     */
    fun onSessions(ctx: Context, before: List<Session>, now: List<Session>): List<String> {
        val nm = NotificationManagerCompat.from(ctx)
        val approvals = now.mapNotNull { s -> s.approval?.takeIf { it.rid.isNotEmpty() }?.let { s to it } }
        val questions = now.mapNotNull { s -> s.question?.takeIf { it.rid.isNotEmpty() }?.let { s to it } }
        val freshApprovals = approvals.filter { (_, a) -> a.rid !in posted }
        val freshQuestions = questions.filter { (_, q) -> q.rid !in posted }
        val fresh = freshApprovals.map { it.second.rid } + freshQuestions.map { it.second.rid }
        val stillThere = (approvals.map { it.second.rid } + questions.map { it.second.rid }).toSet()
        synchronized(posted) {
            for (rid in posted.filter { it !in stillThere }) {
                nm.cancel(idFor(rid))
                posted.remove(rid)
            }
        }
        if (!canPost(ctx)) return fresh
        val settings = Settings.shared
        // Switched off: still in the app, just no ping. Requests are urgent, so quiet hours don't hold them back.
        for ((s, a) in freshApprovals) {
            if (settings.notifyNeedsYou) nm.notify(idFor(a.rid), approval(ctx, s, a))
            synchronized(posted) { posted.add(a.rid) }
        }
        for ((s, q) in freshQuestions) {
            if (settings.notifyNeedsYou) nm.notify(idFor(q.rid), question(ctx, s, q))
            synchronized(posted) { posted.add(q.rid) }
        }
        val quiet = settings.quietHours && Settings.isQuiet(java.time.LocalTime.now().hour)
        val holds = now.mapNotNull { s -> s.reply?.let { it.rid to s } }.toMap()
        for (s in now) {
            val wanted = when (s.status) {
                Status.Done -> settings.notifyDone
                Status.Error -> settings.notifyErrors
                // Its turn ended asking something at the PC (Command Code's plan review).
                Status.Waiting -> s.ask != null && settings.notifyNeedsYou
                else -> false
            }
            val was = before.firstOrNull { it.id == s.id }?.status
            val justEnded = if (s.status == Status.Waiting) was != Status.Waiting else was == Status.Working || was == Status.Waiting
            // The hold can arrive a moment after the task ends: then the same notification gains Reply.
            val newHold = s.reply != null && synchronized(replying) { s.reply.rid !in replying }
            if ((justEnded || newHold) && wanted && !quiet) {
                nm.notify(idFor("end:${s.id}"), ended(ctx, s))
                s.reply?.let { synchronized(replying) { replying[it.rid] = s.id } }
            }
        }
        // Held no longer (replied from anywhere, someone's back at the PC, timed out): take Reply away.
        val over = synchronized(replying) { replying.filterKeys { it !in holds }.also { gone -> gone.keys.forEach(replying::remove) } }
        for ((_, sessionId) in over) {
            val s = now.firstOrNull { it.id == sessionId } ?: continue
            if (isShowing(nm, idFor("end:$sessionId"))) nm.notify(idFor("end:$sessionId"), ended(ctx, s))
        }
        return fresh
    }

    private fun isShowing(nm: NotificationManagerCompat, id: Int): Boolean =
        try {
            nm.activeNotifications.any { it.id == id }
        } catch (e: Exception) {
            false
        }

    /** Removes everything the link posted (unpaired, or the PC unlinked this phone). */
    fun clearLink(ctx: Context) {
        val nm = NotificationManagerCompat.from(ctx)
        synchronized(replying) {
            for (sessionId in replying.values) nm.cancel(idFor("end:$sessionId"))
            replying.clear()
        }
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

    /** Claude's question: answered in the app (the lock screen shows only that there is one). */
    private fun question(ctx: Context, s: Session, q: Question): Notification {
        val open = openApp(ctx, q.rid)
        val lockScreen = NotificationCompat.Builder(ctx, CHANNEL_APPROVALS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("A question for you")
            .setContentText("Unlock to see it")
            .build()
        val first = q.items.first().question
        return NotificationCompat.Builder(ctx, CHANNEL_APPROVALS)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("${s.project} has a question")
            .setContentText(first)
            .setStyle(NotificationCompat.BigTextStyle().bigText(q.items.joinToString("\n") { it.question }.take(600)))
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setPublicVersion(lockScreen)
            .setColor(0xFF9FB6FA.toInt())
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Answer", open)
            .setTimeoutAfter(120_000)
            .build()
    }

    /**
     * A task that finished or failed, or ended asking something at the PC.
     * While the PC holds it for a reply, Reply right in the notification (the
     * phone must be unlocked to send it).
     */
    private fun ended(ctx: Context, s: Session): Notification {
        val ask = s.ask?.takeIf { s.status == Status.Waiting }
        val title = when {
            ask != null -> "${s.project} is waiting for you"
            s.status == Status.Done -> "${s.project} is done"
            else -> "${s.project} stopped"
        }
        val text = if (ask != null) {
            val choices = ask.items.joinToString("\n\n") { q -> (listOf(q.question) + q.options.map { "• ${it.label}" }).joinToString("\n") }
            "$choices\n\nPick one in ${ask.where} on your PC."
        } else {
            s.summary ?: s.line
        }
        val b = NotificationCompat.Builder(ctx, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle(title)
            .setContentText(s.line)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text.take(1000)))
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setColor(0xFF9FB6FA.toInt())
            .setAutoCancel(true)
            // Gaining or losing Reply updates it quietly.
            .setOnlyAlertOnce(true)
            .setContentIntent(openApp(ctx, null))
        val hold = s.reply ?: return b.build()
        val id = idFor("end:${s.id}")
        val input = RemoteInput.Builder(KEY_REPLY).setLabel("Reply to ${s.agent}").build()
        // Mutable: Android adds the typed text to it. Explicit, to our own receiver only.
        val send = PendingIntent.getBroadcast(
            ctx, id,
            Intent(ctx, ActionReceiver::class.java).setAction(ACTION_REPLY).putExtra(EXTRA_ID, id).putExtra(EXTRA_RID, hold.rid),
            PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val reply = NotificationCompat.Action.Builder(0, "Reply", send)
            .addRemoteInput(input)
            .setAllowGeneratedReplies(false)
            .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY)
            .setAuthenticationRequired(true)
            .build()
        val minutes = ((hold.until - System.currentTimeMillis()) / 60_000).coerceAtLeast(1)
        return b.setSubText("Waiting for your reply · $minutes min")
            .setTimeoutAfter((hold.until - System.currentTimeMillis()).coerceAtLeast(1_000))
            .addAction(reply)
            .build()
    }

    /** "A new version is ready": opens the app, where Settings has the Update button. */
    fun updateAvailable(ctx: Context, versionName: String) {
        if (!canPost(ctx)) return
        val n = NotificationCompat.Builder(ctx, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentTitle("Desk Companion $versionName is ready")
            .setContentText("Open Settings to update")
            .setColor(0xFF9FB6FA.toInt())
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx, null))
            .build()
        NotificationManagerCompat.from(ctx).notify(UPDATE_ID, n)
    }

    /** The sample approval from Settings → Try it. */
    fun showTestApproval(ctx: Context) {
        if (!canPost(ctx)) return
        val sample = Session(id = "test", agent = "Claude Code", project = "shop-app", status = Status.Waiting, line = "")
        val n = approval(ctx, sample, Approval(rid = "", tool = "Bash", action = "run", detail = "npm test -- --coverage"))
        NotificationManagerCompat.from(ctx).notify(TEST_ID, n)
    }
}
