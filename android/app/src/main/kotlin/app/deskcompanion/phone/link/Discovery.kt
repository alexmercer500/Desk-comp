package app.deskcompanion.phone.link

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.net.Inet4Address
import java.net.NetworkInterface
import javax.net.ssl.SSLSocket

/**
 * Finding the PC again when its address changed (a phone hotspot hands out
 * new ones). Knocks on the link's port across the phone's own local networks,
 * at most the /24 around each of its private addresses, and keeps the first
 * computer that shows the paired certificate. The pin is checked during the
 * TLS handshake, before anything is sent, so another machine on the network
 * never sees the token; it only sees a connection attempt.
 */
object Discovery {
    /** TCP connect timeout per address: local networks answer in a few ms, or refuse at once. */
    private const val KNOCK_MS = 400
    /** Time for the TLS handshake once a port is open. */
    private const val HANDSHAKE_MS = 3_000
    /** Addresses tried at the same time. */
    private const val PARALLEL = 48

    /**
     * The phone's own IPv4 addresses on local networks, with their prefix
     * lengths (Wi-Fi, hotspot, USB). Not mobile data: carriers hand out
     * private addresses too, but the PC is never there.
     */
    fun ownAddresses(): List<Pair<Int, Int>> = try {
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback && !isMobileData(it.name) }
            .flatMap { it.interfaceAddresses }
            .mapNotNull { a -> (a.address as? Inet4Address)?.let { toInt(it.address) to a.networkPrefixLength.toInt() } }
            .filter { (ip, _) -> isLocal(ip) }
    } catch (e: Exception) {
        emptyList()
    }

    /**
     * Addresses to knock on: every host in the /24 around each local address
     * (the network itself when it's smaller), without the phone's own
     * addresses, the network and broadcast addresses, or [skip].
     */
    fun candidates(own: List<Pair<Int, Int>>, skip: Set<String>): List<String> {
        val mine = own.map { it.first }.toSet()
        val out = LinkedHashSet<String>()
        for ((ip, prefix) in own) {
            if (!isLocal(ip)) continue
            val bits = prefix.coerceIn(24, 30)
            val mask = (-1 shl (32 - bits))
            val network = ip and mask
            val size = 1 shl (32 - bits)
            for (i in 1 until size - 1) {
                val host = network + i
                if (host !in mine) out += toText(host)
            }
        }
        out.removeAll(skip)
        return out.toList()
    }

    /** Interface names Android phones use for mobile data (and its IPv4-over-IPv6 and VPN tunnels). */
    private val MOBILE = listOf("rmnet", "ccmni", "pdp", "wwan", "v4-", "clat", "seth", "ppp", "tun", "dummy")

    fun isMobileData(name: String?): Boolean = name != null && MOBILE.any { name.startsWith(it, ignoreCase = true) }

    /** Private, carrier-grade NAT (some hotspots) and link-local ranges: never anything on the internet. */
    fun isLocal(ip: Int): Boolean {
        val a = (ip ushr 24) and 0xff
        val b = (ip ushr 16) and 0xff
        return a == 10 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 100 && b in 64..127) || (a == 169 && b == 254)
    }

    /**
     * Knocks on every candidate and returns the first that proves to be the
     * paired PC, with its open connection; null when none does.
     */
    @OptIn(ExperimentalCoroutinesApi::class)
    suspend fun find(p: Pairing, skip: Set<String>): Pair<String, SSLSocket>? {
        val hosts = candidates(ownAddresses(), skip)
        if (hosts.isEmpty()) return null
        val io = Dispatchers.IO.limitedParallelism(PARALLEL)
        val found = CompletableDeferred<Pair<String, SSLSocket>?>()
        return coroutineScope {
            val tries = hosts.map { host ->
                async(io) {
                    if (found.isCompleted) return@async
                    val socket = try {
                        PinnedTls.connect(host, p.port, p.fingerprint, KNOCK_MS, HANDSHAKE_MS)
                    } catch (e: Exception) {
                        return@async
                    }
                    // Only the first one is kept; a second (the same PC on two networks) is closed.
                    if (!found.complete(host to socket)) socket.close()
                }
            }
            launch {
                tries.awaitAll()
                found.complete(null)
            }
            val result = found.await()
            // Addresses not tried yet are skipped; ones in flight finish within their timeouts.
            coroutineContext.cancelChildren()
            result
        }
    }

    private fun toInt(b: ByteArray): Int =
        ((b[0].toInt() and 0xff) shl 24) or ((b[1].toInt() and 0xff) shl 16) or ((b[2].toInt() and 0xff) shl 8) or (b[3].toInt() and 0xff)

    fun toText(ip: Int): String = "${(ip ushr 24) and 0xff}.${(ip ushr 16) and 0xff}.${(ip ushr 8) and 0xff}.${ip and 0xff}"

    fun parse(text: String): Int? {
        val parts = text.split('.')
        if (parts.size != 4) return null
        var ip = 0
        for (part in parts) {
            val n = part.toIntOrNull()?.takeIf { it in 0..255 } ?: return null
            ip = (ip shl 8) or n
        }
        return ip
    }
}
