package app.deskcompanion.phone.link

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * The link through the relay (docs/RELAY.md): a WebSocket to the room named by
 * the pairing's keys, carrying the same lines as the direct link, each sealed
 * for the PC and opened from it ([RelayCrypto]).
 *
 * Starting: the relay says who's in the room; once the PC is there the phone
 * sends `hi` with a fresh session id, and the PC answers `hi` with its own.
 * After that only frames naming both sessions, each with a higher number than
 * the last, are accepted, so nothing recorded earlier can be played back.
 */
class RelayWire private constructor(private val keys: RelayCrypto.Keys, private val readTimeoutMs: Long) : Wire {
    override val host: String? = null

    private sealed interface Event {
        data class Line(val text: String) : Event
        /** `reason` null: an ordinary end. */
        data class End(val reason: String?) : Event
    }

    private val events = LinkedBlockingQueue<Event>()
    /** Completes with null once the PC answered `hi`, or with why it never will. */
    private val ready = CompletableFuture<String?>()
    private val mine = RelayCrypto.newSession()
    @Volatile private var theirs: ByteArray? = null
    @Volatile private var hiSent = false
    /** The relay said the PC isn't in the room (for a clearer message when it never comes). */
    @Volatile private var pcAway = false
    private var lastIn = 0L
    private var seqOut = 0L
    private lateinit var ws: WebSocket

    private val listener = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(JSONObject().put("t", "hello").put("role", "phone").put("admit", keys.admit).toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            val m = try {
                JSONObject(text)
            } catch (e: Exception) {
                return
            }
            when (m.optString("t")) {
                "peers" -> {
                    val pc = m.optBoolean("pc", false)
                    when {
                        // The PC left the relay (it restarted, or the relay was switched off there).
                        !pc && theirs != null -> end("Your PC left the relay")
                        !pc -> pcAway = true
                        // Once, or again after the PC came back (repeated announcements don't count:
                        // each hi makes the PC start a new session).
                        theirs == null && (!hiSent || pcAway) -> {
                            hiSent = true
                            pcAway = false
                            val hi = RelayCrypto.sealToPc(keys, RelayCrypto.Header(RelayCrypto.HI, mine, ByteArray(RelayCrypto.SESSION), 0), ByteArray(0))
                            webSocket.send(msg(hi))
                        }
                    }
                }
                "msg" -> onFrame(m.optString("d"))
            }
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            end(closeReason(code))
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = end(closeReason(code))

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            end(if (theirs == null) "Couldn't reach the relay" else "Lost the relay")
    }

    /** OkHttp delivers messages one at a time, so this never runs twice at once. */
    private fun onFrame(d: String) {
        val (h, plain) = RelayCrypto.openFromPc(keys, d) ?: return // not from our PC
        when (h.kind) {
            RelayCrypto.HI -> if (theirs == null && h.seq == 0L && h.to.contentEquals(mine) && plain.isEmpty()) {
                theirs = h.from
                ready.complete(null)
            }
            RelayCrypto.DATA -> {
                val pc = theirs ?: return
                if (!h.from.contentEquals(pc) || !h.to.contentEquals(mine) || h.seq <= lastIn) return // another session's, or seen before
                lastIn = h.seq
                val line = String(plain, Charsets.UTF_8)
                if (!line.contains('\n')) events.put(Event.Line(line))
            }
        }
    }

    private fun end(reason: String?) {
        events.put(Event.End(reason))
        ready.complete(reason ?: "The relay closed the connection")
    }

    private fun msg(d: String) = JSONObject().put("t", "msg").put("d", d).toString()

    override fun send(line: String) {
        val pc = theirs ?: return
        val text = line.removeSuffix("\n")
        // Numbered and sent in one go, so the PC gets them in order.
        synchronized(this) {
            seqOut += 1
            ws.send(msg(RelayCrypto.sealToPc(keys, RelayCrypto.Header(RelayCrypto.DATA, mine, pc, seqOut), text.toByteArray(Charsets.UTF_8))))
        }
    }

    override fun readLine(): String? = when (val e = events.poll(readTimeoutMs, TimeUnit.MILLISECONDS)) {
        null -> throw SocketTimeoutException("The PC stopped answering")
        is Event.Line -> e.text
        is Event.End -> {
            events.put(e) // stays ended
            if (e.reason == null) null else throw IOException(e.reason)
        }
    }

    override fun close() {
        if (::ws.isInitialized) ws.close(1000, null)
        events.put(Event.End(null))
        ready.complete("closed")
    }

    companion object {
        /** `https://host[:port]` of the relay → the room's WebSocket address. */
        fun roomUrl(relay: String, room: String) = "wss://" + relay.removePrefix("https://") + "/r/" + room

        /**
         * Connects through the relay and waits up to [waitMs] for the PC to
         * answer. Throws with a reason the user can act on when it doesn't.
         */
        fun open(p: Pairing, relay: String, client: OkHttpClient, waitMs: Long, readTimeoutMs: Long): RelayWire {
            val keys = RelayCrypto.derive(p.token) ?: throw IOException("This pairing can't use the relay. Scan the code again.")
            val wire = RelayWire(keys, readTimeoutMs)
            wire.ws = client.newWebSocket(Request.Builder().url(roomUrl(relay, keys.room)).build(), wire.listener)
            val failed = try {
                wire.ready.get(waitMs, TimeUnit.MILLISECONDS)
            } catch (e: TimeoutException) {
                if (wire.pcAway) "Your PC isn't on the relay. Is Desk Companion running there, with Reach your phone anywhere on?" else "The relay didn't answer"
            }
            if (failed != null) {
                wire.close()
                throw IOException(failed)
            }
            return wire
        }

        private fun closeReason(code: Int): String? = when (code) {
            1000, 1001 -> null
            4401 -> "The relay refused this phone (wrong room secret). Scan the code on the PC again."
            4003 -> "Too many phones on the relay right now"
            4429 -> "Sent the relay too much at once"
            else -> "The relay closed the connection"
        }
    }
}
