package app.deskcompanion.phone.model

import android.graphics.Bitmap

/** A picture of an agent session's window on the PC (Peek), as far as it got. */
sealed interface Peek {
    /** Asked at [since] (elapsed ms); [previous] stays on screen meanwhile. */
    data class Loading(val since: Long, val previous: Ready? = null) : Peek

    /** [at]: when the PC took it (ms since 1970). */
    data class Ready(val image: Bitmap, val title: String, val at: Long) : Peek

    /** Why there's no picture, in words to show. */
    data class Failed(val reason: String) : Peek
}
