package app.deskcompanion.phone.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import app.deskcompanion.phone.link.LinkHub

/**
 * A notification's Deny button, without opening the app. Deny is always safe,
 * so it needs no unlock; Allow never comes through here.
 */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Notifications.ACTION_DENY) return
        // A tap in the first moments is most likely a stray one on a notification that just popped up.
        val at = intent.getLongExtra(Notifications.EXTRA_AT, 0L)
        if (at > 0 && System.currentTimeMillis() - at < Notifications.GUARD_MS) return
        NotificationManagerCompat.from(context).cancel(intent.getIntExtra(Notifications.EXTRA_ID, -1))
        val rid = intent.getStringExtra(Notifications.EXTRA_RID).orEmpty()
        val text = when {
            rid.isEmpty() -> "Denied (sample)"
            LinkHub.decide(rid, allow = false) -> "Denied"
            else -> "Not connected to your PC: answer it there"
        }
        Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    }
}
