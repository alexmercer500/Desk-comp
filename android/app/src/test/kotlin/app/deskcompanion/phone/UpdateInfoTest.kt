package app.deskcompanion.phone

import app.deskcompanion.phone.update.UpdateInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class UpdateInfoTest {
    private val hash = "a".repeat(64)

    private fun json(
        code: String = "5",
        url: String = "https://github.com/o/r/releases/download/v1/app.apk",
        sha: String = hash,
        size: String = "6000000",
    ) = """{"versionCode":$code,"versionName":"0.4.0","url":"$url","sha256":"$sha","size":$size,"notes":"New"}"""

    @Test fun readsAGoodFile() {
        val i = UpdateInfo.parse(json())
        assertNotNull(i)
        assertEquals(5, i!!.versionCode)
        assertEquals("0.4.0", i.versionName)
        assertEquals(hash, i.sha256)
        assertEquals(6_000_000L, i.size)
    }

    @Test fun upperCaseHashIsAccepted() {
        assertEquals(hash, UpdateInfo.parse(json(sha = hash.uppercase()))!!.sha256)
    }

    @Test fun refusesAnythingNotHttps() {
        assertNull(UpdateInfo.parse(json(url = "http://example.com/app.apk")))
        assertNull(UpdateInfo.parse(json(url = "file:///sdcard/app.apk")))
    }

    @Test fun refusesABadHash() {
        assertNull(UpdateInfo.parse(json(sha = "abc")))
        assertNull(UpdateInfo.parse(json(sha = "z".repeat(64))))
    }

    @Test fun refusesNonsense() {
        assertNull(UpdateInfo.parse("not json"))
        assertNull(UpdateInfo.parse("{}"))
        assertNull(UpdateInfo.parse(json(code = "0")))
        assertNull(UpdateInfo.parse(json(size = "999999999999")))
    }

    @Test fun newerMeansHigherVersionCode() {
        val i = UpdateInfo.parse(json(code = "5"))!!
        assertTrue(i.isNewerThan(4))
        assertFalse(i.isNewerThan(5))
        assertFalse(i.isNewerThan(6))
    }

    @Test fun checkOnlyOverHttps() {
        assertTrue(UpdateInfo.checkable("https://example.com/android.json"))
        assertFalse(UpdateInfo.checkable(""))
        assertFalse(UpdateInfo.checkable("http://example.com/android.json"))
    }

    @Test fun sha256IsStandard() {
        assertEquals("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", UpdateInfo.sha256("abc".toByteArray()))
    }
}
