package app.deskcompanion.phone.link

import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.net.Socket

/**
 * One connection to the PC, carrying the link's lines: straight over the local
 * network ([SocketWire]) or through the relay ([RelayWire]). LinkHub talks to
 * the PC the same way over either.
 */
interface Wire : Closeable {
    /** The PC's address this went to; null through the relay. */
    val host: String?

    /** Sends one line (with its newline). Errors are left for the reading side to notice. */
    fun send(line: String)

    /** The next line, without its newline; null at the end. Blocks; throws when the PC goes quiet too long. */
    fun readLine(): String?
}

/** A pinned TLS connection on the local network. */
class SocketWire(override val host: String, private val socket: Socket, private val maxLine: Int) : Wire {
    private val input: InputStream = socket.getInputStream()
    private val out = socket.getOutputStream()

    override fun send(line: String) {
        synchronized(this) {
            try {
                out.write(line.toByteArray(Charsets.UTF_8))
                out.flush()
            } catch (e: IOException) {
                // The reading side notices and reconnects.
            }
        }
    }

    /** Refuses absurdly long lines. */
    override fun readLine(): String? {
        val buf = java.io.ByteArrayOutputStream()
        while (true) {
            val b = input.read()
            if (b == -1) return if (buf.size() == 0) null else buf.toString("UTF-8")
            if (b == '\n'.code) return buf.toString("UTF-8")
            buf.write(b)
            if (buf.size() > maxLine) throw IOException("line too long")
        }
    }

    override fun close() {
        try {
            socket.close()
        } catch (e: Exception) {
        }
    }
}
