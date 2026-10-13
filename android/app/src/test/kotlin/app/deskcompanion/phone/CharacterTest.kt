package app.deskcompanion.phone

import app.deskcompanion.phone.link.Protocol
import app.deskcompanion.phone.model.Characters
import app.deskcompanion.phone.model.Look
import app.deskcompanion.phone.model.Status
import org.junit.Assert.assertEquals
import org.junit.Test

class CharacterTest {
    @Test
    fun picturesAreNamedByCharacterAndMood() {
        assertEquals("char_kulhi_work", Characters.picture("kulhi", "toy", "cream", Status.Working))
        assertEquals("char_glim_call", Characters.picture("glim", "toy", "cream", Status.Waiting))
        assertEquals("char_billu_droop", Characters.picture("billu", "toy", "cream", Status.Error))
        // Rui has his own poses, a look and a colour; done and idle share his idle pose.
        assertEquals("rui_idle_anime_mint", Characters.picture("rui", "anime", "mint", Status.Done))
        assertEquals("rui_call_toy_cream", Characters.picture("rui", "nonsense", "nonsense", Status.Waiting))
        // An unknown character falls back to Kulhi.
        assertEquals("char_kulhi_idle", Characters.picture("dragon", "toy", "cream", Status.Idle))
    }

    @Test
    fun ruiTakesHisColourFromTheme() {
        assertEquals(Characters.accent("rui", "panda"), Characters.accent("rui", "panda"))
        assert(Characters.accent("rui", "peach") != Characters.accent("rui", "sky"))
        assertEquals(Characters.info("kulhi").accent, Characters.accent("kulhi", "mint"))
    }

    @Test
    fun theLookOnlyTakesKnownNames() {
        Look.show("glim")
        assertEquals("glim", Look.character)
        Look.show("dragon", "toy", "cream")
        assertEquals("glim", Look.character)
        Look.show("rui", look = "anime", theme = "neon")
        assertEquals("rui", Look.character)
        assertEquals("anime", Look.ruiLook)
        assertEquals("cream", Look.ruiTheme)
        Look.show("kulhi")
    }

    @Test
    fun theCharacterMessageRoundTrips() {
        assertEquals(
            Protocol.FromPc.Character("rui", "anime", "mint"),
            Protocol.parse("""{"t":"character","id":"rui","look":"anime","theme":"mint"}"""),
        )
        assertEquals("""{"t":"character","id":"glim"}""", Protocol.character("glim", null, null).trim())
    }
}
