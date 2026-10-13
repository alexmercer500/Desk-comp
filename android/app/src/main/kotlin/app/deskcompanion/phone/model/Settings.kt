package app.deskcompanion.phone.model

import android.content.Context

/**
 * The switches in Settings, kept on this phone. Notifications read them too
 * (they can fire with the app closed), so [shared] is set once at start-up.
 */
class Settings(private val read: (String, Boolean) -> Boolean, private val write: (String, Boolean) -> Unit) {
    var notifyDone: Boolean
        get() = read("notifyDone", true)
        set(v) = write("notifyDone", v)
    var notifyNeedsYou: Boolean
        get() = read("notifyNeedsYou", true)
        set(v) = write("notifyNeedsYou", v)
    var notifyErrors: Boolean
        get() = read("notifyErrors", true)
        set(v) = write("notifyErrors", v)
    var quietHours: Boolean
        get() = read("quietHours", false)
        set(v) = write("quietHours", v)
    var requireUnlockForAllow: Boolean
        get() = read("requireUnlockForAllow", true)
        set(v) = write("requireUnlockForAllow", v)
    var awayMode: Boolean
        get() = read("awayMode", true)
        set(v) = write("awayMode", v)

    companion object {
        /** Settings that live only in memory (tests, previews). */
        fun memory(): Settings {
            val m = mutableMapOf<String, Boolean>()
            return Settings({ k, d -> m[k] ?: d }, { k, v -> m[k] = v })
        }

        @Volatile
        var shared: Settings = memory()
            private set

        fun init(ctx: Context): Settings {
            val prefs = ctx.applicationContext.getSharedPreferences("settings", Context.MODE_PRIVATE)
            shared = Settings({ k, d -> prefs.getBoolean(k, d) }, { k, v -> prefs.edit().putBoolean(k, v).apply() })
            return shared
        }

        /** 10 pm to 8 am. */
        fun isQuiet(hour: Int): Boolean = hour >= 22 || hour < 8
    }
}
