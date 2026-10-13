package app.deskcompanion.phone.link

import java.net.InetSocketAddress
import java.net.Socket
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509TrustManager

/**
 * A TLS 1.3 connection to the PC that accepts exactly one certificate: the one
 * whose SHA-256 the pairing code carried. No certificate authority is
 * consulted and no host name is checked; the fingerprint is the whole trust.
 */
object PinnedTls {
    fun connect(host: String, port: Int, fingerprint: String, connectTimeoutMs: Int, readTimeoutMs: Int): SSLSocket {
        val trust = PinnedTrust(fingerprint)
        val context = SSLContext.getInstance("TLSv1.3").apply { init(null, arrayOf(trust), SecureRandom()) }
        val raw = Socket()
        try {
            raw.connect(InetSocketAddress(host, port), connectTimeoutMs)
            raw.soTimeout = readTimeoutMs
            raw.tcpNoDelay = true
            val tls = context.socketFactory.createSocket(raw, host, port, true) as SSLSocket
            tls.enabledProtocols = arrayOf("TLSv1.3")
            tls.startHandshake()
            return tls
        } catch (e: Exception) {
            raw.close()
            throw e
        }
    }

    fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    private class PinnedTrust(private val expected: String) : X509TrustManager {
        override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
            val leaf = chain?.firstOrNull() ?: throw CertificateException("no certificate")
            val got = sha256Hex(leaf.encoded)
            // Constant time, though the fingerprint isn't secret: no reason to leak where it differs.
            if (!MessageDigest.isEqual(got.toByteArray(), expected.toByteArray())) {
                throw CertificateException("not the paired computer's certificate")
            }
        }

        override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
            throw CertificateException("client certificates aren't used")

        override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
    }
}
