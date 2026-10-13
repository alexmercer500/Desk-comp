package app.deskcompanion.phone

import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Filter
import app.deskcompanion.phone.model.Status
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppStateTest {
    @Test
    fun whatNeedsYouComesFirst() {
        val state = AppState()
        assertEquals("s1", state.hero?.id)
        assertEquals(Status.Waiting, state.visible.first().status)
        assertEquals(1, state.waitingCount)
    }

    @Test
    fun filtersPickTheirOwnSessions() {
        val state = AppState()
        state.filter = Filter.Working
        assertEquals(listOf("s2"), state.visible.map { it.id })
        state.filter = Filter.NeedsYou
        assertEquals(setOf("s1", "s4"), state.visible.map { it.id }.toSet())
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
}
