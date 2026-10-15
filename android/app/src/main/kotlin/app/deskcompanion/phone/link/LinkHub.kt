package app.deskcompanion.phone.link

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.SystemClock
import androidx.core.content.ContextCompat
import android.os.Build
import app.deskcompanion.phone.model.Look
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Settings
import app.deskcompanion.phone.notify.Notifications
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The one link to the paired PC: connects (trying each of its addresses),
 * signs in, keeps the session list current, and sends decisions. Reconnects
 * on its own, waiting a little longer each time (up to 30 s), and at once
 * when the phone's network changes or the app is opened.
 *
 * Addresses change (a phone hotspot hands the PC a new one): the PC sends its
 * current ones on every connect and they're saved; when none of the known
 * ones answers, the phone's own network is searched for the PC (Discovery),
 * at most every SCAN_EVERY_MS.
 *
 * Away from the PC's network, with the relay on at the PC (the pairing then
 * knows its address), the link goes through the relay instead, end-to-end
 * encrypted (RelayWire). While it does, the PC's own addresses are tried now
 * and then (and on every network change), and the link moves back to the
 * direct one as soon as the PC answers there.
 */
object LinkHub {
    sealed interface State {
        data object Unpaired : State
        /** `searching`: the known addresses didn't answer, so the network is being searched. `relay`: trying the relay. */
        data class Connecting(val name: String, val searching: Boolean = false, val relay: Boolean = false) : State
        /** `relayed`: through the relay, not the local network. */
        data class Connected(val name: String, val approvals: Boolean, val relayed: Boolean = false) : State
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
    /** Least time between two searches of the network for the PC. */
    private const val SCAN_EVERY_MS = 30_000L
    /** With no local network at all, wait this long (or for a network to appear) before trying again. */
    private const val NO_NETWORK_WAIT_MS = 5 * 60_000L
    /** Most addresses remembered for the PC. */
    private const val MAX_HOSTS = 8
    /** Time for the PC to answer through the relay. */
    private const val RELAY_WAIT_MS = 12_000L
    /** While linked through the relay, how often to see whether the PC can be reached directly again. */
    private const val PROBE_EVERY_MS = 5 * 60_000L

    /** For the relay's WebSocket. Pings keep it (and the mobile network's NAT) awake and notice a dead one. */
    private val http by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .pingInterval(30, TimeUnit.SECONDS)
            .build()
    }

    private val _state = MutableStateFlow<State>(State.Unpaired)
    val state: StateFlow<State> = _state
    private val _sessions = MutableStateFlow<List<Session>>(emptyList())
    val sessions: StateFlow<List<Session>> = _sessions

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    /** Wakes the reconnect loop early: the network changed, or the app was opened. */
    private val wake = Channel<Unit>(Channel.CONFLATED)
    @Volatile private var lastScan = 0L
    @Volatile private var wire: Wire? = null
    /** A direct connection found while linked through the relay, to switch to. */
    @Volatile private var handoff: Wire? = null
    @Volatile private var lastError: Exception? = null
    private var app: Context? = null
    var paired: Pairing? = null
        private set

    /** At app or service start: reconnects to the saved PC, if any. Safe to call more than once. */
    @Synchronized
    fun init(ctx: Context) {
        if (app != null) return
        app = ctx.applicationContext
        watchNetworks(ctx.applicationContext)
        PairingStore.load(ctx.applicationContext)?.let { connect(it) }
    }

    /**
     * Try again now if the link is down (the app came to the front, a network
     * appeared); through the relay, see whether the PC can be reached directly.
     */
    fun nudge() {
        val s = _state.value
        if (paired != null && (s !is State.Connected || s.relayed)) wake.trySend(Unit)
    }

    /** Any network appearing or changing (Wi-Fi joined, hotspot on or off) is a reason to try at once. */
    private fun watchNetworks(ctx: Context) {
        try {
            val cm = ctx.getSystemService(ConnectivityManager::class.java)
            // Not only networks with internet: a hotspot or a router that's offline can still reach the PC.
            val any = NetworkRequest.Builder().removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
            cm.registerNetworkCallback(any, object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) = nudge()
                override fun onLinkPropertiesChanged(network: Network, lp: LinkProperties) = nudge()
            })
        } catch (e: Exception) {
            // Without it the loop still retries on its own.
        }
        // The phone's own hotspot isn't a network the phone joins, so it has its own broadcast.
        val tether = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) = nudge()
        }
        ContextCompat.registerReceiver(ctx, tether, IntentFilter("android.net.conn.TETHER_STATE_CHANGED"), ContextCompat.RECEIVER_NOT_EXPORTED)
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

    /** The user picked a character here: shown at once, and the PC is told (it checks the name and switches too). */
    fun pickCharacter(id: String, look: String? = null, theme: String? = null, outfit: String? = null) {
        showCharacter(id, look, theme, outfit)
        if (_state.value is State.Connected) scope.launch { send(Protocol.character(id, look, theme, outfit)) }
    }

    private fun showCharacter(id: String, look: String?, theme: String?, outfit: String?) {
        Look.show(id, look, theme, outfit)
        Settings.shared.run {
            character = Look.character
            ruiLook = Look.ruiLook
            ruiTheme = Look.ruiTheme
            dogeshOutfit = Look.dogeshOutfit
        }
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
        job = scope.launch { loop() }
    }

    private suspend fun loop() {
        var wait = 1_000L
        while (currentCoroutineContext().isActive) {
            val p = paired ?: return
            wake.tryReceive() // a nudge from before this attempt is used up by it
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
            // No local network at all: nothing to try until one appears (it nudges), so don't spin.
            // A direct connection was found while on the relay: switch to it at once.
            if (handoff != null) continue
            val offline = Discovery.ownAddresses().isEmpty() && p.relay == null
            _state.value = State.Retrying(p.name, if (offline) "Not on a network. Waiting for Wi-Fi or your hotspot" else reason)
            val nudged = withTimeoutOrNull(if (offline) NO_NETWORK_WAIT_MS else wait) { wake.receive() } != null
            wait = if (nudged) 1_000L else (wait * 2).coerceAtMost(30_000L)
        }
    }

    /** One connection, until it ends. True when the PC unlinked this phone (don't retry). */
    private suspend fun session(p: Pairing, onWelcome: () -> Unit): Boolean {
        val w = open(p)
        wire = w
        val pinger = scope.launch {
            while (isActive) {
                delay(PING_MS)
                send(Protocol.ping())
            }
        }
        val prober = if (w.host == null) scope.launch { probe(p, w) } else null
        try {
            // Through the relay too: the token goes inside the encryption, and the PC checks it the same way.
            send(Protocol.hello(p.token, deviceName(), Settings.shared.awayMode))
            while (true) {
                val line = w.readLine() ?: return false
                when (val m = Protocol.parse(line)) {
                    is Protocol.FromPc.Welcome -> {
                        onWelcome()
                        remember(p, w.host, m.hosts, m.relay)
                        _state.value = State.Connected(m.name, m.approvals, relayed = w.host == null)
                    }
                    is Protocol.FromPc.Sessions -> onSessions(m.sessions)
                    is Protocol.FromPc.Character -> showCharacter(m.id, m.look, m.theme, m.outfit)
                    is Protocol.FromPc.Error -> {
                        if (m.code == "token") return true
                        throw IOException(m.message.ifEmpty { m.code })
                    }
                    else -> Unit
                }
            }
        } finally {
            pinger.cancel()
            prober?.cancel()
            wire = null
            w.close()
        }
    }

    /**
     * While linked through the relay: every PROBE_EVERY_MS, or when the network
     * changes, tries the PC's own addresses; if one answers, keeps it for the
     * next connection and ends the relay one.
     */
    private suspend fun probe(p: Pairing, relayed: Wire) {
        while (currentCoroutineContext().isActive) {
            withTimeoutOrNull(PROBE_EVERY_MS) { wake.receive() }
            if (Discovery.ownAddresses().isEmpty()) continue
            val direct = tryHosts(paired ?: p) ?: continue
            handoff = direct
            relayed.close()
            return
        }
    }

    /** The first of the PC's known addresses that answers, or null (the last failure in [lastError]). */
    private fun tryHosts(p: Pairing): Wire? {
        for (host in p.hosts) {
            try {
                return SocketWire(host, PinnedTls.connect(host, p.port, p.fingerprint, CONNECT_TIMEOUT_MS, READ_TIMEOUT_MS), MAX_LINE)
            } catch (e: Exception) {
                lastError = e
            }
        }
        return null
    }

    /**
     * The direct link first: each of the PC's known addresses in turn, then (if
     * the network wasn't searched in the last SCAN_EVERY_MS) a search of it.
     * Only on a local network: on mobile data there's nothing to find. Then
     * the relay, when the PC has it on.
     */
    private suspend fun open(p: Pairing): Wire {
        handoff?.let {
            handoff = null
            return it
        }
        var last: Exception? = null
        if (Discovery.ownAddresses().isNotEmpty()) {
            lastError = null
            tryHosts(p)?.let { return it }
            last = lastError
            val now = SystemClock.elapsedRealtime()
            if (lastScan == 0L || now - lastScan >= SCAN_EVERY_MS) {
                lastScan = now
                _state.value = State.Connecting(p.name, searching = true)
                Discovery.find(p, p.hosts.toSet())?.let { (host, sock) ->
                    sock.soTimeout = READ_TIMEOUT_MS
                    return SocketWire(host, sock, MAX_LINE)
                }
                last = IOException("Couldn't find your PC on this network")
            }
        }
        p.relay?.let { relay ->
            _state.value = State.Connecting(p.name, relay = true)
            return RelayWire.open(p, relay, http, RELAY_WAIT_MS, READ_TIMEOUT_MS.toLong())
        }
        throw last ?: IOException("no address")
    }

    /**
     * Keeps the address that just worked first, then the PC's own current ones,
     * then the older ones; and the relay's address as the PC has it now.
     */
    private fun remember(p: Pairing, used: String?, offered: List<String>, relay: String?) {
        val hosts = if (used != null) Pairing.mergeHosts(used, offered, p.hosts, MAX_HOSTS) else p.hosts
        if ((hosts == p.hosts && relay == p.relay) || paired != p) return
        val next = p.copy(hosts = hosts, relay = relay)
        paired = next
        app?.let { PairingStore.save(it, next) }
    }

    private fun onSessions(list: List<Session>) {
        val before = _sessions.value
        _sessions.value = list
        val ctx = app ?: return
        // Tell the PC the phone is showing each new request, so the agent keeps waiting for an answer.
        for (rid in Notifications.onSessions(ctx, before, list)) seen(rid)
    }

    private fun send(line: String) {
        wire?.send(line)
    }

    private fun closeSocket() {
        wire?.close()
        wire = null
        handoff?.close()
        handoff = null
    }

    private fun deviceName(): String {
        val maker = Build.MANUFACTURER.replaceFirstChar { it.uppercase() }
        return if (Build.MODEL.startsWith(maker, ignoreCase = true)) Build.MODEL else "$maker ${Build.MODEL}"
    }

    private fun friendly(e: Exception): String = when {
        e.message == "Couldn't find your PC on this network" ->
            "Couldn't find your PC on this network. Is it on the same Wi-Fi or your hotspot, with Settings → Phone on? Is the app allowed through the firewall?"
        e is javax.net.ssl.SSLHandshakeException || e.cause is java.security.cert.CertificateException ->
            "That isn't the paired PC (its certificate changed). Scan the code again."
        e is java.net.SocketTimeoutException -> "The PC stopped answering"
        e is java.net.ConnectException || e is java.net.NoRouteToHostException ->
            "Can't reach the PC. Same Wi-Fi (or hotspot)? Is Settings → Phone on, and the app allowed through the firewall?"
        else -> e.message ?: "The connection failed"
    }
}
