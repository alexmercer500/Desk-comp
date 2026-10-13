package app.deskcompanion.phone.link

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.content.ContextCompat
import app.deskcompanion.phone.notify.Notifications

/**
 * Keeps the app's process (and so the link) alive while it's in the
 * background, with a quiet ongoing notification. All the work is in LinkHub;
 * this only exists while a PC is paired.
 */
class LinkService : Service() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        startForeground(Notifications.LINK_ID, Notifications.linkOngoing(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        LinkHub.init(this)
    }

    // Restarted by Android if it had to stop the app: the hub reconnects to the saved PC.
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        fun start(ctx: Context) {
            try {
                ContextCompat.startForegroundService(ctx, Intent(ctx, LinkService::class.java))
            } catch (e: Exception) {
                // Not allowed from the background right now; the app starts it next time it's opened.
            }
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, LinkService::class.java))
        }
    }
}
