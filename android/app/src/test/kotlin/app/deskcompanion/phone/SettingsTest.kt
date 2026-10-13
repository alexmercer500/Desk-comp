package app.deskcompanion.phone

import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SettingsTest {
    @Test
    fun quietHoursAreTenPmToEightAm() {
        assertTrue(Settings.isQuiet(22))
        assertTrue(Settings.isQuiet(23))
        assertTrue(Settings.isQuiet(0))
        assertTrue(Settings.isQuiet(7))
        assertFalse(Settings.isQuiet(8))
        assertFalse(Settings.isQuiet(21))
    }

    @Test
    fun changesAreKeptInTheStoreAndSurviveANewState() {
        val store = Settings.memory()
        val a = AppState(store = store)
        assertTrue(a.requireUnlockForAllow)
        a.changeRequireUnlockForAllow(false)
        a.changeQuietHours(true)
        val b = AppState(store = store) // as after restarting the app
        assertFalse(b.requireUnlockForAllow)
        assertTrue(b.quietHours)
        assertEquals(true, b.notifyDone)
    }
}
