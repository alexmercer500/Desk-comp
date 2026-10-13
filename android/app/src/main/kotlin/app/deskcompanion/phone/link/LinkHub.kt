package app.deskcompanion.phone.link

import android.content.Context
import android.os.Build
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Settings
import app.deskcompanion.phone.notify.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.Socket

/**
 * The one link to the paired PC: connects (trying each of its addresses),
 * signs in, keeps the session list current, and sends decisions. Reconnects
 * on its own, waiting a little longer each time (up to 30 s).
 */
object LinkHub {
    sealed interface State {
        data object Unpaired : State
        data class Connecting(val name: String) : State
        data class Connected(val name: String, val approvals: Boolean) : State
        /** Lost or unreachable; trying again. */
        data class Retrying(val name: String, val reason: String) : State
        /** The PC refused this phone (Pair again on the PC): scan the new code. */
        data class Unlinked(val name: String) : State
    }

    private const val CONNECT_TIMEOUT_MS = 3_000
    /** The phone pings every 25 s and the PC answers, so a minute of silence means the link is gone. */
    private const val READ_TIMEOUT_MS = 60_000
    private const val PING_MS = 25_000L
    private const val MAX_LINE = 70_000

    private val _state = MutableStateFlow<State>(State.Unpaired)
    val state: StateFlow<State> = _state
    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    private val writeLock = Any()
    @Volatile private var out: OutputStream? = null
    @Volatile private var socket: Socket? = null
    private var app: Context? = null
    var paired: Pairing? = null
        private set

    /** At app or service start: reconnects to the saved PC, if any. Safe to call more than once. */
    @Synchronized
    fun init(ctx: Context) {
        if (app != null) return
        app = ctx.applicationContext
        PairingStore.load(ctx.applicationContext)?.let { connect(it) }
    }

    /** Pairs with a PC (after the user confirmed) and connects. */
    @Synchronized
    fun pair(ctx: Context, p: Pairing) {
        app = ctx.applicationContext
        PairingStore.save(ctx.applicationContext, p)
        connect(p)
    }

    /** Forgets the PC: no more link, no more notifications. */
    @Synchronized
    fun unpair(ctx: Context) {
        job?.cancel()
        closeSocket()
        PairingStore.clear(ctx)
        paired = null
        _sessions.value = emptyList()
        _state.value = State.Unpaired
        Notifications.clearLink(ctx)
        LinkService.stop(ctx)
    }

    /** Allow or Deny; false when not connected right now. */
    fun decide(rid: String, allow: Boolean): Boolean {
        if (_state.value !is State.Connected) return false
        scope.launch { send(Protocol.decision(rid, allow)) }
        return true
    }

    /** Answers to Claude's question card; false when not connected right now. */
    fun answer(rid: String, answers: Map<String, String>): Boolean {
        if (_state.value !is State.Connected || answers.isEmpty()) return false
        scope.launch { send(Protocol.answer(rid, answers)) }
        return true
    }

    /** A further prompt for a turn the PC is holding; false when not connected right now. */
    fun reply(rid: String, text: String): Boolean {
        val t = text.trim().take(Protocol.MAX_REPLY)
        if (_state.value !is State.Connected || t.isEmpty()) return false
        scope.launch { send(Protocol.reply(rid, t)) }
        return true
    }

    /** Away mode changed in Settings: the PC holds finished turns only for a phone that wants it. */
    fun setAway(on: Boolean) {
        if (_state.value is State.Connected) scope.launch { send(Protocol.away(on)) }
    }

    private fun seen(rid: String) {
        scope.launch { send(Protocol.seen(rid)) }
    }

    private fun connect(p: Pairing) {
        paired = p
        job?.cancel()
        closeSocket()
        app?.let { LinkService.start(it) }
        job = scope.launch { loop(p) }
    }

    private suspend fun loop(p: Pairing) {
        var wait = 1_000L
        while (currentCoroutineContext().isActive) {
            _state.value = State.Connecting(p.name)
            var welcomed = false
            val reason = try {
                if (session(p) { welcomed = true }) {
                    _state.value = State.Unlinked(p.name)
                    _sessions.value = emptyList()
                    app?.let { Notifications.clearLink(it) }
                    return
                }
                "The connection closed"
            } catch (e: Exception) {
                friendly(e)
            }
            if (!currentCoroutineContext().isActive) return
            if (welcomed) wait = 1_000L
            _state.value = State.Retrying(p.name, reason)
            delay(wait)
            wait = (wait * 2).coerceAtMost(30_000L)
        }
    }

    /** One connection, until it ends. True when the PC unlinked this phone (don't retry). */
    private fun session(p: Pairing, onWelcome: () -> Unit): Boolean {
        val sock = open(p)
        socket = sock
        val pinger = scope.launch {
            while (isActive) {
                delay(PING_MS)
                send(Protocol.ping())
            }
        }
        try {
            out = sock.getOutputStream()
            send(Protocol.hello(p.token, deviceName(), Settings.shared.awayMode))
            val input = sock.getInputStream()
            while (true) {
                val line = readLine(input) ?: return false
                when (val m = Protocol.parse(line)) {
                    is Protocol.FromPc.Welcome -> {
                        onWelcome()
                        _state.value = State.Connected(m.name, m.approvals)
                    }
                    is Protocol.FromPc.Sessions -> onSessions(m.sessions)
                    is Protocol.FromPc.Error -> {
                        if (m.code == "token") return true
                        throw IOException(m.message.ifEmpty { m.code })
                    }
                    else -> Unit
                }
            }
        } finally {
            pinger.cancel()
            out = null
            socket = null
            sock.close()
        }
    }

    /** Tries each of the PC's addresses in turn. */
    private fun open(p: Pairing): Socket {
        var last: Exception? = null
        for (host in p.hosts) {
            try {
                return PinnedTls.connect(host, p.port, p.fingerprint, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS)
            } catch (e: Exception) {
                last = e
            }
        }
        throw last ?: IOException("no address")
    }

    private fun onSessions(list: List<Session>) {
        val before = _sessions.value
        _sessions.value = list
        val ctx = app ?: return
        // Tell the PC the phone is showing each new request, so the agent keeps waiting for an answer.
        for (rid in Notifications.onSessions(ctx, before, list)) seen(rid)
    }

    private fun send(line: String) {
        synchronized(writeLock) {
            try {
                out?.apply {
                    write(line.toByteArray(Charsets.UTF_8))
                    flush()
                }
            } catch (e: IOException) {
                // The reading side notices and reconnects.
            }
        }
    }

    /** One line, without its newline; null at the end of the stream. Refuses absurdly long lines. */
    private fun readLine(input: InputStream): String? {
        val buf = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) return if (buf.size() == 0) null else buf.toString("UTF-8")
            if (b == '\n'.code) return buf.toString("UTF-8")
            buf.write(b)
            if (buf.size() > MAX_LINE) throw IOException("line too long")
        }
    }

    private fun closeSocket() {
        try {
            socket?.close()
        } catch (e: Exception) {
        }
        socket = null
        out = null
    }

    private fun deviceName(): String {
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        return if (Build.MODEL.startsWith(maker, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
    }

    private fun friendly(e: Exception): String = when {
        e is javax.net.ssl.SSLHandshakeException || e.cause is java.security.cert.CertificateException ->
            "That isn't the paired PC (its certificate changed). Scan the code again."
        e is java.net.SocketTimeoutException -> "The PC stopped answering"
        e is java.net.ConnectException || e is java.net.NoRouteToHostException ->
            "Can't reach the PC. Same Wi-Fi (or hotspot)? Is Settings → Phone on, and the app allowed through the firewall?"
        else -> e.message ?: "The connection failed"
    }
}
