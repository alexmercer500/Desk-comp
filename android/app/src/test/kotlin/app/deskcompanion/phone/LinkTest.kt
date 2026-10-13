package app.deskcompanion.phone

import app.deskcompanion.phone.link.Pairing
import app.deskcompanion.phone.link.Protocol
import app.deskcompanion.phone.model.Status
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LinkTest {
    private val fp = "91d9b23169824de8e14245dffcf4f999dfed2929043b78ac434f67f2d7ecb17f"
    private val token = "SbJK4Y9zdrDTU_SLdkY7ezh9HdzfGEPi93MKY9tntvI"
    private val good = "deskcompanion://pair?v=1&hosts=192.168.5.34,10.42.0.15&port=47822&fp=$fp&token=$token&name=Nidhi%27s%20PC"

    @Test
    fun aPairingLinkFromThePcIsRead() {
        val p = Pairing.parse(good)!!
        assertEquals(listOf("192.168.5.34", "10.42.0.15"), p.hosts)
        assertEquals(47822, p.port)
        assertEquals(fp, p.fingerprint)
        assertEquals(token, p.token)
        assertEquals("Nidhi's PC", p.name)
        assertFalse("the token never shows in logs", p.toString().contains(token))
    }

    @Test
    fun damagedOrForeignLinksAreRefused() {
        for (bad in listOf(
            "",
            "https://example.com",
            good.replace("deskcompanion://", "coucou://"),
            good.replace("v=1", "v=2"),
            good.replace("fp=$fp", "fp=abc"),
            good.replace("token=$token", "token=short"),
            good.replace("port=47822", "port=70000"),
            good.replace("hosts=192.168.5.34,10.42.0.15", "hosts="),
            good.replace("hosts=192.168.5.34,10.42.0.15", "hosts=evil.com/path"),
        )) {
            assertNull(bad, Pairing.parse(bad))
        }
    }

    @Test
    fun messagesToThePcAreSingleJsonLines() {
        val hello = Protocol.hello(token, "Pixel 7")
        assertTrue(hello.endsWith("\n"))
        val o = JSONObject(hello)
        assertEquals("hello", o.getString("t"))
        assertEquals(1, o.getInt("v"))
        assertEquals("deny", JSONObject(Protocol.decision("r1", allow = false)).getString("decision"))
        assertEquals("allow", JSONObject(Protocol.decision("r1", allow = true)).getString("decision"))
        assertEquals("r1", JSONObject(Protocol.seen("r1")).getString("rid"))
    }

    @Test
    fun theSessionListBecomesSessions() {
        val line = """{"t":"sessions","sessions":[
            {"id":"s1","agent":"Claude Code","project":"shop","status":"waiting","line":"Wants to run","prompt":"Run tests","summary":null,
             "steps":[{"tool":"Bash","detail":"npm test","failed":false}],"files":[{"path":"a.ts","add":3,"del":1}],"updatedAt":1760000000000,
             "approval":{"rid":"s1:1:2","tool":"Bash","action":"run","detail":"npm test","canAlways":true}},
            {"id":"s2","agent":"Codex","project":"blog","status":"done","line":"Added it","approval":null},
            {"no-id":true}
        ]}"""
        val m = Protocol.parse(line) as Protocol.FromPc.Sessions
        assertEquals(2, m.sessions.size)
        val s = m.sessions[0]
        assertEquals(Status.Waiting, s.status)
        assertEquals("s1:1:2", s.approval!!.rid)
        assertEquals("npm test", s.approval!!.detail)
        assertNull(s.summary)
        assertEquals(3, s.files[0].add)
        assertEquals(1760000000000, s.updatedAt)
        assertEquals(Status.Done, m.sessions[1].status)
        assertNull(m.sessions[1].approval)
    }

    @Test
    fun otherMessagesFromThePc() {
        assertEquals(Protocol.FromPc.Welcome("PC", true), Protocol.parse("""{"t":"welcome","v":1,"name":"PC","approvals":true}"""))
        assertEquals(Protocol.FromPc.Error("token", "Scan again"), Protocol.parse("""{"t":"error","code":"token","message":"Scan again"}"""))
        assertEquals(Protocol.FromPc.Decided("r", false), Protocol.parse("""{"t":"decided","rid":"r","ok":false}"""))
        assertEquals(Protocol.FromPc.Pong, Protocol.parse("""{"t":"pong"}"""))
        assertEquals(Protocol.FromPc.Other, Protocol.parse("""{"t":"something-new"}"""))
        assertNull(Protocol.parse("not json"))
        assertNotNull(Protocol.parse("""{"t":"sessions"}"""))
    }
}
