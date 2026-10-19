package app.deskcompanion.phone

import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Approval
import app.deskcompanion.phone.model.Filter
import app.deskcompanion.phone.model.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import app.deskcompanion.phone.model.Settings
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.ReplyHold
import org.junit.Test

class AppStateTest {
    @Test
    fun whatNeedsYouComesFirst() {
        val state = AppState()
        assertEquals("s1", state.hero?.id)
        assertEquals(Status.Waiting, state.visible.first().status)
        assertEquals(2, state.waitingCount)
    }

    @Test
    fun filtersPickTheirOwnSessions() {
        val state = AppState()
        state.filter = Filter.Working
        assertEquals(listOf("s2"), state.visible.map { it.id })
        state.filter = Filter.NeedsYou
        assertEquals(setOf("s1", "s4", "s5"), state.visible.map { it.id }.toSet())
        state.filter = Filter.Done
        assertEquals(listOf("s3"), state.visible.map { it.id })
    }

    @Test
    fun allowLetsTheAgentCarryOnAndIsRemembered() {
        val state = AppState()
        state.decide("s1", allow = true)
        val s = state.session("s1")!!
        assertEquals(Status.Working, s.status)
        assertNull(s.approval)
        assertEquals(1, state.decisions.size)
        assertTrue(state.decisions.first().allowed)
    }

    @Test
    fun aDecisionOnlyAnswersTheRequestThatWasOnScreen() {
        val shown = Session(
            id = "a", agent = "Claude Code", project = "p", status = Status.Waiting, line = "Wants to run",
            approval = Approval(rid = "r1", tool = "Bash", action = "run", detail = "npm test"),
        )
        val state = AppState(listOf(shown))
        val sent = mutableListOf<Pair<String, Boolean>>()
        state.showLive(listOf(shown))
        state.onDecide = { rid, allow -> sent += rid to allow; true }
        // While the fingerprint prompt was up, the PC answered r1 and the session asked for something else.
        state.showLive(listOf(shown.copy(approval = Approval(rid = "r2", tool = "Bash", action = "run", detail = "rm -rf build/"))))
        assertFalse(state.decide("a", allow = true, rid = "r1"))
        assertTrue(sent.isEmpty())
        assertFalse(state.stillWaiting("a", "r1"))
        assertTrue(state.stillWaiting("a", "r2"))
        assertTrue(state.decide("a", allow = false, rid = "r2"))
        assertEquals(listOf("r2" to false), sent)
    }

    @Test
    fun whatWasTooLongForThePhoneCanOnlyBeDenied() {
        val long = Session(
            id = "a", agent = "Claude Code", project = "p", status = Status.Waiting, line = "Wants to run",
            approval = Approval(rid = "r1", tool = "Bash", action = "run", detail = "npm test && …", allow = false),
        )
        val state = AppState(listOf(long))
        assertFalse(state.decide("a", allow = true, rid = "r1"))
        assertEquals(Status.Waiting, state.session("a")!!.status)
        assertTrue(state.decide("a", allow = false, rid = "r1"))
    }

    @Test
    fun denyStopsItAndANewDecisionForTheSameRequestIsIgnored() {
        val state = AppState()
        state.decide("s1", allow = false)
        assertEquals(Status.Idle, state.session("s1")!!.status)
        state.decide("s1", allow = true) // too late: the request is gone
        assertEquals(Status.Idle, state.session("s1")!!.status)
        assertEquals(1, state.decisions.size)
        assertFalse(state.decisions.first().allowed)
    }

    @Test
    fun aReplyOnlyWorksOnAFinishedSessionAndStartsItAgain() {
        val state = AppState()
        assertFalse(state.reply("s2", "hello")) // still working
        assertFalse(state.reply("s3", "   ")) // nothing typed
        assertTrue(state.reply("s3", "  Also add a test for burst traffic  "))
        val s = state.session("s3")!!
        assertEquals(Status.Working, s.status)
        assertEquals("Also add a test for burst traffic", s.prompt)
    }

    @Test
    fun aQuestionNeedsAnAnswerForEveryItem() {
        val state = AppState(store = Settings.memory())
        assertFalse(state.answer("s5", emptyMap()))
        assertFalse(state.answer("s5", mapOf("Which way should dark mode follow?" to "  ")))
        assertTrue(state.answer("s5", mapOf("Which way should dark mode follow?" to "The phone's setting")))
        assertNull(state.session("s5")!!.question)
        assertEquals(Status.Working, state.session("s5")!!.status)
        assertFalse(state.answer("s5", mapOf("Which way should dark mode follow?" to "Again"))) // already answered
    }

    @Test
    fun liveRepliesOnlyGoToATurnThePcIsHolding() {
        val state = AppState(store = Settings.memory())
        val sent = mutableListOf<Pair<String, String>>()
        state.onReply = { rid, text -> sent += rid to text; true }
        val done = Session(id = "a", agent = "Claude Code", project = "p", status = Status.Done, line = "Done")
        state.showLive(listOf(done, done.copy(id = "b", reply = ReplyHold("h1", Long.MAX_VALUE))))
        assertFalse(state.reply("a", "carry on")) // finished, but nothing is waiting for a reply
        assertTrue(state.reply("b", " carry on "))
        assertEquals(listOf("h1" to "carry on"), sent)
        assertNull(state.session("b")!!.reply)
        state.onReply = { _, _ -> false } // not connected
        state.showLive(listOf(done.copy(reply = ReplyHold("h2", Long.MAX_VALUE))))
        assertFalse(state.reply("a", "again"))
        assertEquals(Status.Done, state.session("a")!!.status)
    }

    @Test
    fun theGreetingIsYourNameElseThePcElseAPlainHello() {
        val store = Settings.memory()
        val state = AppState(store = store)
        assertEquals("Hello", state.greeting(null))
        assertEquals("PC-0001", state.greeting("PC-0001"))
        state.changeDisplayName("  Nidhi  ")
        assertEquals("Hello, Nidhi", state.greeting("PC-0001"))
        state.changeDisplayName("")
        assertEquals("PC-0001", state.greeting("PC-0001"))
        state.changeDisplayName("ab" + "x".repeat(40))
        assertEquals(30, state.displayName.length)
        assertEquals("ab", state.displayName.take(2)) // control characters dropped
        assertEquals(state.displayName.trim(), AppState(store = store).displayName)
    }
}
