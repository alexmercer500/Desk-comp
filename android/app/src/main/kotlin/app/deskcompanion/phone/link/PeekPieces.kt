package app.deskcompanion.phone.link

import java.util.Base64

/**
 * Puts a window's picture back together: the PC sends it in pieces (each
 * line stays short enough for the link and the relay). A first piece starts a
 * new picture for its session; a piece that doesn't fit what was started is
 * dropped. Used on the link's reading thread only.
 */
class PeekPieces {
    /** A complete picture: the JPEG, and what the first piece said about it. */
    class Picture(val jpeg: ByteArray, val title: String, val at: Long)

    private class Started(val parts: Int, val title: String, val at: Long) {
        val data = arrayOfNulls<String>(parts)
    }

    private val started = HashMap<String, Started>()

    /** Adds a piece; returns the picture once its last piece is in, or null. */
    fun add(m: Protocol.FromPc.Peek): Picture? {
        if (m.parts !in 1..MAX_PARTS || m.part !in 0 until m.parts) return null
        val s = if (m.part == 0) Started(m.parts, m.title, m.at).also { started[m.session] = it } else started[m.session] ?: return null
        if (s.parts != m.parts) return null
        s.data[m.part] = m.data
        if (s.data.any { it == null }) return null
        started.remove(m.session)
        val jpeg = try {
            Base64.getDecoder().decode(s.data.joinToString(""))
        } catch (e: IllegalArgumentException) {
            return null
        }
        return Picture(jpeg, s.title, s.at)
    }

    /** The PC said there's no picture: forget what was started. */
    fun drop(session: String) {
        started.remove(session)
    }

    companion object {
        /** More pieces than any picture the PC sends (it keeps them under 600 KB). */
        const val MAX_PARTS = 40
    }
}
