package app.deskcompanion.phone.link

import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The relay's end-to-end encryption (docs/RELAY.md), the same as the PC's
 * (src-tauri/src/phone/relay.rs). Everything comes from the pairing token with
 * HKDF-SHA256: the room's name, the secret that lets us into it, and one
 * AES-256-GCM key per direction. The relay never has any of them.
 *
 * A frame is base64 of: version | kind | sender session (16) | receiver
 * session (16) | sequence (8) | nonce (12) | ciphertext and tag. The first 42
 * bytes are authenticated.
 */
object RelayCrypto {
    private val SALT = "desk-companion relay v1".toByteArray()
    private const val VERSION: Byte = 1
    const val HI: Byte = 1
    const val DATA: Byte = 2
    const val SESSION = 16
    private const val HEADER = 2 + SESSION * 2 + 8
    private const val NONCE = 12
    private const val TAG = 16
    private const val MAX_FRAME_TEXT = 96 * 1024
    private val random = SecureRandom()

    class Keys(val room: String, val admit: String, internal val toPhone: ByteArray, internal val toPc: ByteArray) {
        override fun toString() = "RelayKeys(room=$room)" // never the keys
    }

    /** The keys for a pairing token (43 characters of base64url), or null when it isn't one. */
    fun derive(token: String): Keys? {
        val secret = try {
            Base64.getUrlDecoder().decode(token)
        } catch (e: IllegalArgumentException) {
            return null
        }
        if (secret.size != 32) return null
        val prk = hmac(SALT, secret)
        return Keys(
            room = hex(expand(prk, "room", 16)),
            admit = hex(expand(prk, "admit", 32)),
            toPhone = expand(prk, "pc>phone", 32),
            toPc = expand(prk, "phone>pc", 32),
        )
    }

    /** HKDF-Expand for up to 32 bytes: one block. */
    private fun expand(prk: ByteArray, info: String, len: Int): ByteArray {
        require(len <= 32)
        return hmac(prk, info.toByteArray() + byteArrayOf(1)).copyOf(len)
    }

    private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
        Mac.getInstance("HmacSHA256").run {
            init(SecretKeySpec(key, "HmacSHA256"))
            doFinal(data)
        }

    private fun hex(b: ByteArray) = b.joinToString("") { "%02x".format(it) }

    class Header(val kind: Byte, val from: ByteArray, val to: ByteArray, val seq: Long) {
        fun bytes(): ByteArray = ByteBuffer.allocate(HEADER).put(VERSION).put(kind).put(from).put(to).putLong(seq).array()
    }

    fun newSession(): ByteArray = ByteArray(SESSION).also { random.nextBytes(it) }

    /** Sealed for the PC. */
    fun sealToPc(k: Keys, h: Header, plain: ByteArray): String = seal(k.toPc, h, plain)

    /** A frame from the PC, or null unless it decrypts (and was sealed for the phone). */
    fun openFromPc(k: Keys, d: String): Pair<Header, ByteArray>? = open(k.toPhone, d)

    // For tests: what the PC does.
    internal fun sealToPhone(k: Keys, h: Header, plain: ByteArray): String = seal(k.toPhone, h, plain)
    internal fun openFromPhone(k: Keys, d: String): Pair<Header, ByteArray>? = open(k.toPc, d)

    private fun seal(key: ByteArray, h: Header, plain: ByteArray): String {
        val head = h.bytes()
        val nonce = ByteArray(NONCE).also { random.nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG * 8, nonce))
        cipher.updateAAD(head)
        return Base64.getEncoder().encodeToString(head + nonce + cipher.doFinal(plain))
    }

    private fun open(key: ByteArray, d: String): Pair<Header, ByteArray>? {
        if (d.length > MAX_FRAME_TEXT) return null
        val raw = try {
            Base64.getDecoder().decode(d)
        } catch (e: IllegalArgumentException) {
            return null
        }
        if (raw.size < HEADER + NONCE + TAG || raw[0] != VERSION) return null
        val head = raw.copyOfRange(0, HEADER)
        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG * 8, raw, HEADER, NONCE))
            cipher.updateAAD(head)
            val plain = cipher.doFinal(raw, HEADER + NONCE, raw.size - HEADER - NONCE)
            val b = ByteBuffer.wrap(head, 1, HEADER - 1)
            val kind = b.get()
            val from = ByteArray(SESSION).also { b.get(it) }
            val to = ByteArray(SESSION).also { b.get(it) }
            Header(kind, from, to, b.getLong()) to plain
        } catch (e: Exception) {
            null // wrong key, or changed on the way
        }
    }
}
