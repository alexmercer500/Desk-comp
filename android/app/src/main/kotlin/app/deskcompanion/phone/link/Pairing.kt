package app.deskcompanion.phone.link

import java.net.URI
import java.net.URLDecoder

/**
 * What the PC's pairing code carries (docs/PHONE_LINK.md):
 * `deskcompanion://pair?v=1&hosts=…&port=…&fp=…&token=…&name=…`.
 */
data class Pairing(
    /** The PC's addresses, best first. */
    val hosts: List<String>,
    val port: Int,
    /** SHA-256 of the PC's certificate, lowercase hex: the only certificate accepted. */
    val fingerprint: String,
    /** The secret the phone signs in with. */
    val token: String,
    /** The PC's name, to show. */
    val name: String,
) {
    override fun toString() = "Pairing($name, ${hosts.joinToString()}:$port)" // never the token

    companion object {
        private val HEX64 = Regex("^[0-9a-f]{64}$")
        private val TOKEN = Regex("^[A-Za-z0-9_-]{43}$")
        // An IPv4 address or a plain host name: nothing that could smuggle in a path or a port.
        private val HOST = Regex("^[A-Za-z0-9.-]{1,253}$")

        /** The pairing in a link, or null when it isn't one of ours or is damaged. */
        fun parse(text: String): Pairing? {
            val uri = try {
                URI(text.trim())
            } catch (e: Exception) {
                return null
            }
            if (uri.scheme != "deskcompanion" || uri.host != "pair") return null
            val q = (uri.rawQuery ?: return null).split('&').mapNotNull { part ->
                val i = part.indexOf('=')
                if (i <= 0) null else part.substring(0, i) to decode(part.substring(i + 1))
            }.toMap()
            if (q["v"] != "1") return null
            val hosts = q["hosts"].orEmpty().split(',').map { it.trim() }.filter { HOST.matches(it) }.take(8)
            val port = q["port"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            val fp = q["fp"]?.lowercase()?.takeIf { HEX64.matches(it) } ?: return null
            val token = q["token"]?.takeIf { TOKEN.matches(it) } ?: return null
            if (hosts.isEmpty()) return null
            val name = q["name"].orEmpty().filter { !it.isISOControl() }.trim().take(60).ifEmpty { "Your PC" }
            return Pairing(hosts, port, fp, token, name)
        }

        private fun decode(s: String): String = try {
            URLDecoder.decode(s, "UTF-8")
        } catch (e: Exception) {
            ""
        }
    }
}
