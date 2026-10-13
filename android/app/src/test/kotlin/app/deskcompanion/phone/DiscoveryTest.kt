package app.deskcompanion.phone

import app.deskcompanion.phone.link.Discovery
import app.deskcompanion.phone.link.Pairing
import app.deskcompanion.phone.link.Protocol
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {
    private fun ip(s: String) = Discovery.parse(s)!!

    @Test
    fun aHotspotSubnetIsSearchedWithoutThePhoneItself() {
        // The phone as a hotspot: 10.42.0.1/24.
        val hosts = Discovery.candidates(listOf(ip("10.42.0.1") to 24), skip = setOf("10.42.0.7"))
        assertEquals(252, hosts.size) // .1 to .254, minus the phone (.1) and the address already tried (.7)
        assertFalse("10.42.0.1" in hosts)
        assertFalse("10.42.0.0" in hosts)
        assertFalse("10.42.0.255" in hosts)
        assertTrue("10.42.0.2" in hosts && "10.42.0.254" in hosts)
    }

    @Test
    fun bigNetworksAreOnlySearchedAroundThePhone() {
        // A /16 office network: only the phone's own /24, never 65 000 addresses.
        val hosts = Discovery.candidates(listOf(ip("172.20.5.40") to 16), skip = emptySet())
        assertEquals(253, hosts.size)
        assertTrue(hosts.all { it.startsWith("172.20.5.") })
        // A small one (/28) stays small.
        assertEquals(13, Discovery.candidates(listOf(ip("192.168.1.65") to 28), emptySet()).size)
    }

    @Test
    fun nothingOutsideLocalRangesIsEverSearched() {
        assertTrue(Discovery.candidates(listOf(ip("8.8.8.8") to 24, ip("100.200.1.1") to 24), emptySet()).isEmpty())
        for (ok in listOf("10.0.0.1", "172.16.0.1", "172.31.9.9", "192.168.43.1", "100.64.0.1", "169.254.1.1")) assertTrue(ok, Discovery.isLocal(ip(ok)))
        for (no in listOf("172.32.0.1", "11.0.0.1", "192.169.0.1", "100.128.0.1", "1.1.1.1")) assertFalse(no, Discovery.isLocal(ip(no)))
    }

    @Test
    fun addressesAreParsedStrictly() {
        assertEquals("192.168.1.20", Discovery.toText(ip("192.168.1.20")))
        for (bad in listOf("", "1.2.3", "1.2.3.4.5", "256.1.1.1", "a.b.c.d", "1..2.3")) assertEquals(bad, null, Discovery.parse(bad))
    }

    @Test
    fun theAddressThatWorkedComesFirstAndThePcsOwnAreKept() {
        val merged = Pairing.mergeHosts(
            used = "10.42.0.9",
            offered = listOf("10.42.0.9", "192.168.1.20", "evil.example/x", "999.1.1.1", "fe80::1"),
            known = listOf("192.168.1.20", "10.42.0.15"),
            max = 8,
        )
        assertEquals(listOf("10.42.0.9", "192.168.1.20", "10.42.0.15"), merged)
        assertEquals(2, Pairing.mergeHosts("a", listOf("1.1.1.1", "2.2.2.2"), emptyList(), 2).size)
    }

    @Test
    fun theWelcomeCarriesThePcsAddresses() {
        val m = Protocol.parse("""{"t":"welcome","v":1,"name":"PC","approvals":true,"hosts":["192.168.1.20","10.0.0.5"]}""")
        assertEquals(Protocol.FromPc.Welcome("PC", true, listOf("192.168.1.20", "10.0.0.5")), m)
        assertEquals(Protocol.FromPc.Welcome("PC", true), Protocol.parse("""{"t":"welcome","v":1,"name":"PC","approvals":true}"""))
    }
}
