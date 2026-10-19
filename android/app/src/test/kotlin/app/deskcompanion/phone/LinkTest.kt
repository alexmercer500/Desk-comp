package app.deskcompanion.phone

import app.deskcompanion.phone.link.Pairing
import app.deskcompanion.phone.link.PeekPieces
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
        assertNull(p.relay)
        assertEquals("https://r.example.workers.dev", Pairing.parse("$good&relay=https%3A%2F%2Fr.example.workers.dev")!!.relay)
    }

    @Test
    fun relayAddressesAreCheckedAndMadePlain() {
        assertEquals("https://desk-companion-relay.me.workers.dev", Pairing.relayAddress(" https://Desk-Companion-Relay.me.workers.dev/ "))
        assertEquals("https://relay.example.com:8443", Pairing.relayAddress("wss://relay.example.com:8443"))
        for (bad in listOf(
            null, "", "relay.example.com", "http://relay.example.com", "https://", "https://relay.example.com/r/x",
            "https://user@relay.example.com", "https://relay.example.com:99999", "https://-relay.example.com", "https://relay.example.com?x",
        )) {
            assertNull(bad, Pairing.relayAddress(bad))
        }
        // A PC with no local network a phone could join pairs through the relay alone.
        val noHosts = good.replace("hosts=192.168.5.34,10.42.0.15", "hosts=")
        assertNull(Pairing.parse(noHosts))
        val relayOnly = Pairing.parse("$noHosts&relay=https%3A%2F%2Fr.example.workers.dev")!!
        assertEquals(emptyList<String>(), relayOnly.hosts)
        assertEquals("https://r.example.workers.dev", relayOnly.relay)
        // A bad relay address in a pairing link is left out; the pairing itself still works.
        assertNull(Pairing.parse("$good&relay=http%3A%2F%2Fevil.example")!!.relay)
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
        val hello = Protocol.hello(token, "Pixel 7", away = true)
        assertTrue(hello.endsWith("\n"))
        val o = JSONObject(hello)
        assertEquals("hello", o.getString("t"))
        assertEquals(1, o.getInt("v"))
        assertTrue(o.getBoolean("away"))
        val answer = JSONObject(Protocol.answer("q1", mapOf("Which one?" to "Blue, Green")))
        assertEquals("q1", answer.getString("rid"))
        assertEquals("Blue, Green", answer.getJSONObject("answers").getString("Which one?"))
        val reply = Protocol.reply("h1", "Now the docs\nplease")
        assertEquals(1, reply.count { it == '\n' }) // the line break inside is escaped
        assertEquals("Now the docs\nplease", JSONObject(reply).getString("text"))
        assertFalse(JSONObject(Protocol.away(false)).getBoolean("on"))
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
            {"id":"s3","agent":"Claude Code","project":"app","status":"waiting","line":"Has a question",
             "question":{"rid":"q1","questions":[{"question":"Which?","header":"Pick","multiSelect":true,
               "options":[{"label":"A","description":"first"},{"label":"B","description":null},{"label":""}]}]}},
            {"id":"s4","agent":"Claude Code","project":"api","status":"done","line":"Done","reply":{"rid":"h1","until":1760000300000}},
            {"no-id":true}
        ]}"""
        val m = Protocol.parse(line) as Protocol.FromPc.Sessions
        assertEquals(4, m.sessions.size)
        val q = m.sessions[2].question!!
        assertEquals("q1", q.rid)
        assertEquals("Which?", q.items[0].question)
        assertTrue(q.items[0].multiSelect)
        assertEquals(listOf("A", "B"), q.items[0].options.map { it.label })
        assertNull(q.items[0].options[1].description)
        assertEquals("h1", m.sessions[3].reply!!.rid)
        assertEquals(1760000300000, m.sessions[3].reply!!.until)
        assertNull(m.sessions[0].reply)
        val s = m.sessions[0]
        assertEquals(Status.Waiting, s.status)
        assertEquals("s1:1:2", s.approval!!.rid)
        assertEquals("npm test", s.approval!!.detail)
        assertTrue("a PC that doesn't say sends it whole", s.approval!!.allow)
        assertFalse(
            Protocol.parse("""{"t":"sessions","sessions":[{"id":"x","status":"waiting","approval":{"rid":"r","tool":"Bash","action":"run","detail":"npm…","allow":false}}]}""")
                .let { (it as Protocol.FromPc.Sessions).sessions[0].approval!!.allow },
        )
        assertNull(s.summary)
        assertEquals(3, s.files[0].add)
        assertEquals(1760000000000, s.updatedAt)
        assertEquals(Status.Done, m.sessions[1].status)
        assertNull(m.sessions[1].approval)
        assertNull(m.sessions[1].ask)
    }

    @Test
    fun aPeekArrivesInPiecesAndIsPutBackTogether() {
        assertEquals("""{"t":"peek","session":"s1"}""" + "\n", Protocol.peek("s1"))
        val jpeg = ByteArray(1000) { (it * 7).toByte() }
        val b64 = java.util.Base64.getEncoder().encodeToString(jpeg)
        val first = Protocol.parse("""{"t":"peek","session":"s1","part":0,"parts":2,"data":"${b64.take(600)}","width":4,"height":2,"title":"VS Code","at":5}""") as Protocol.FromPc.Peek
        val second = Protocol.parse("""{"t":"peek","session":"s1","part":1,"parts":2,"data":"${b64.drop(600)}"}""") as Protocol.FromPc.Peek
        assertEquals("VS Code", first.title)
        val p = PeekPieces()
        assertNull("not complete yet", p.add(first))
        val done = p.add(second)!!
        assertTrue(jpeg.contentEquals(done.jpeg))
        assertEquals("VS Code", done.title)
        assertEquals(5L, done.at)
        // A piece with nothing started, or out of range, goes nowhere.
        assertNull(PeekPieces().add(second))
        assertNull(p.add(first.copy(part = 3)))
        assertNull(p.add(first.copy(parts = PeekPieces.MAX_PARTS + 1)))
        // Why there's no picture.
        val failed = Protocol.parse("""{"t":"peek","session":"s1","error":"It's minimized"}""") as Protocol.FromPc.Peek
        assertEquals("It's minimized", failed.error)
        assertNull("no session, no message", Protocol.parse("""{"t":"peek","error":"x"}"""))
    }

    @Test
    fun whatItAsksAtThePcComesWithItsChoices() {
        val line = """{"t":"sessions","sessions":[
            {"id":"c1","agent":"Command Code","project":"shop","status":"waiting","line":"Plan ready for review","question":null,
             "ask":{"headline":"Plan ready for review","where":"Command Code","questions":[{"question":"Begin implementation?","header":"Plan Review",
               "multiSelect":false,"options":[{"label":"Yes, auto-accept edits","description":"No permission prompts"},{"label":"Cancel","description":null}]}]},
             "reply":{"rid":"h2","until":1760000300000}},
            {"id":"c2","agent":"Command Code","project":"blog","status":"waiting","line":"Has a question","ask":{"headline":null,"where":"","questions":[]}}
        ]}"""
        val m = Protocol.parse(line) as Protocol.FromPc.Sessions
        val ask = m.sessions[0].ask!!
        assertEquals("Plan ready for review", ask.headline)
        assertEquals("Command Code", ask.where)
        assertEquals(listOf("Yes, auto-accept edits", "Cancel"), ask.items[0].options.map { it.label })
        assertNull(m.sessions[0].question)
        assertEquals("h2", m.sessions[0].reply!!.rid)
        assertNull("nothing asked: no section", m.sessions[1].ask)
    }

    @Test
    fun otherMessagesFromThePc() {
        assertEquals(Protocol.FromPc.Welcome("PC", true), Protocol.parse("""{"t":"welcome","v":1,"name":"PC","approvals":true}"""))
        assertEquals(Protocol.FromPc.Error("token", "Scan again"), Protocol.parse("""{"t":"error","code":"token","message":"Scan again"}"""))
        assertEquals(Protocol.FromPc.Decided("r", false), Protocol.parse("""{"t":"decided","rid":"r","ok":false}"""))
        assertEquals(Protocol.FromPc.Pong, Protocol.parse("""{"t":"pong"}"""))
        assertEquals(Protocol.FromPc.Other, Protocol.parse("""{"t":"something-new"}"""))
        assertEquals(
            Protocol.FromPc.Welcome("PC", true, listOf("10.0.0.2"), "https://r.example.workers.dev"),
            Protocol.parse("""{"t":"welcome","v":1,"name":"PC","approvals":true,"hosts":["10.0.0.2"],"relay":"https://r.example.workers.dev"}"""),
        )
        assertNull((Protocol.parse("""{"t":"welcome","name":"PC","relay":null}""") as Protocol.FromPc.Welcome).relay)
        assertNull((Protocol.parse("""{"t":"welcome","name":"PC","relay":"http://evil.example"}""") as Protocol.FromPc.Welcome).relay)
        assertNull(Protocol.parse("not json"))
        assertNotNull(Protocol.parse("""{"t":"sessions"}"""))
    }
}
