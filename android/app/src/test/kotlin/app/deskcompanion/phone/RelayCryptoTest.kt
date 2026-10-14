package app.deskcompanion.phone

import app.deskcompanion.phone.link.Discovery
import app.deskcompanion.phone.link.RelayCrypto
import app.deskcompanion.phone.link.RelayCrypto.Header
import app.deskcompanion.phone.link.RelayWire
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64

class RelayCryptoTest {
    /** Bytes 0..31, base64url: the same token the PC's tests (phone/relay.rs) and node use. */
    private val token = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8"

    @Test
    fun keysComeFromTheTokenExactlyAsOnThePc() {
        val k = RelayCrypto.derive(token)!!
        assertEquals("22494d1d6c8b9ae8aa0209dd0dbb9b95", k.room)
        assertEquals("7d2f88774354b599914d1cce1898e20acbb4c9c879e4ae29164e48caf283dbb1", k.admit)
        assertFalse("keys never show in logs", k.toString().contains(k.admit))
        assertNull(RelayCrypto.derive("short"))
        assertNull(RelayCrypto.derive("not base64 at all, not at all, not at all!!"))
        assertEquals("wss://r.example.workers.dev/r/22494d1d6c8b9ae8aa0209dd0dbb9b95", RelayWire.roomUrl("https://r.example.workers.dev", k.room))
    }

    @Test
    fun framesSealedElsewhereOpenHere() {
        // Sealed by node with a fixed nonce; the PC's tests open the same ones.
        val k = RelayCrypto.derive(token)!!
        val fromPc = "AQEDAwMDAwMDAwMDAwMDAwMDBAQEBAQEBAQEBAQEBAQEBAAAAAAAAAAAAAECAwQFBgcICQoLJD7cMpmRUOdq39aiqu1ZsA=="
        val (h, plain) = RelayCrypto.openFromPc(k, fromPc)!!
        assertEquals(RelayCrypto.HI, h.kind)
        assertArrayEquals(ByteArray(16) { 3 }, h.from)
        assertArrayEquals(ByteArray(16) { 4 }, h.to)
        assertEquals(0L, h.seq)
        assertEquals(0, plain.size)
        // A frame for the PC isn't accepted as one from it (each direction has its own key).
        val fromPhone = "AQIBAQEBAQEBAQEBAQEBAQEBAgICAgICAgICAgICAgICAgAAAAAAAAAHAAECAwQFBgcICQoL07RJESzNc/lfbKy0r1FYmQj7u4LqnEGZdSdLyw=="
        assertNull(RelayCrypto.openFromPc(k, fromPhone))
    }

    @Test
    fun aSealedFrameOpensOnlyUnchangedAndOnlyTheOtherWay() {
        val k = RelayCrypto.derive(token)!!
        val h = Header(RelayCrypto.DATA, ByteArray(16) { 1 }, ByteArray(16) { 2 }, 7)
        val d = RelayCrypto.sealToPc(k, h, """{"t":"ping"}""".toByteArray())
        val (got, plain) = RelayCrypto.openFromPhone(k, d)!!
        assertEquals(7L, got.seq)
        assertArrayEquals(h.from, got.from)
        assertEquals("""{"t":"ping"}""", String(plain))
        assertNull(RelayCrypto.openFromPc(k, d))
        val raw = Base64.getDecoder().decode(d)
        for (i in listOf(1, 5, 30, 41, 45, raw.size - 1)) {
            val bad = raw.clone()
            bad[i] = (bad[i].toInt() xor 1).toByte()
            assertNull("byte $i", RelayCrypto.openFromPhone(k, Base64.getEncoder().encodeToString(bad)))
        }
        assertNull(RelayCrypto.openFromPhone(k, "not base64!"))
        assertNotEquals(d, RelayCrypto.sealToPc(k, h, """{"t":"ping"}""".toByteArray()))
        // Another pairing's keys open nothing.
        assertNull(RelayCrypto.openFromPhone(RelayCrypto.derive(Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32) { 7 }))!!, d))
        assertNotNull(RelayCrypto.newSession())
    }

    @Test
    fun mobileDataIsntALocalNetwork() {
        for (name in listOf("rmnet_data0", "ccmni1", "v4-rmnet_data0", "tun0", "clat4")) assertTrue(name, Discovery.isMobileData(name))
        for (name in listOf("wlan0", "swlan0", "ap0", "rndis0", "eth0", null)) assertFalse(name ?: "null", Discovery.isMobileData(name))
    }
}
