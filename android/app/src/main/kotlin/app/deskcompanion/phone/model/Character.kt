package app.deskcompanion.phone.model

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color

/** The characters of Desk Companion, with the colour the app takes from each. */
object Characters {
    class Info(val id: String, val name: String, val what: String, val accent: Color)

    val all = listOf(
        Info("kulhi", "Kulhi", "Chai cup", Color(0xFFC9553B)),
        Info("hexo", "Hexo", "Little robot", Color(0xFF3F83B5)),
        Info("glim", "Glim", "Firefly", Color(0xFF7A62E0)),
        Info("billu", "Billu", "Cat on a saucer", Color(0xFFE08A3C)),
        Info("rui", "Rui", "3D yeti", Color(0xFF2FA27A)),
        Info("dogesh", "Dogesh Bhai", "Scaredy pup", Color(0xFF2F8F8A)),
    )

    /** Rui's colours, as on the PC (his own tint decides the app's). */
    private val ruiAccent = mapOf(
        "cream" to Color(0xFFB98A4E), "mint" to Color(0xFF2FA27A), "sky" to Color(0xFF3F8FD8),
        "lavender" to Color(0xFF8E7CF0), "peach" to Color(0xFFE8845A), "panda" to Color(0xFF4A4A56),
    )
    val ruiThemes = listOf("cream", "mint", "sky", "lavender", "peach", "panda")
    val ruiLooks = listOf("toy", "anime")

    fun info(id: String): Info = all.firstOrNull { it.id == id } ?: all.first()

    fun accent(id: String, ruiTheme: String): Color = if (id == "rui") ruiAccent[ruiTheme] ?: info("rui").accent else info(id).accent

    /** The drawable's name for a character in the mood of a session status (Rui: his own pose and look). */
    fun picture(id: String, ruiLook: String, ruiTheme: String, status: Status): String {
        if (id == "rui") {
            val look = if (ruiLook in ruiLooks) ruiLook else "toy"
            val theme = if (ruiTheme in ruiThemes) ruiTheme else "cream"
            val pose = when (status) {
                Status.Working -> "work"
                Status.Waiting -> "call"
                Status.Error -> "droop"
                else -> "idle"
            }
            return "rui_${pose}_${look}_$theme"
        }
        val who = if (all.any { it.id == id && id != "rui" }) id else "kulhi"
        val mood = when (status) {
            Status.Working -> "work"
            Status.Waiting -> "call"
            Status.Done -> "done"
            Status.Error -> "droop"
            Status.Idle -> "idle"
        }
        return "char_${who}_$mood"
    }
}

/**
 * The character in use right now, shown everywhere and used for the app's
 * colours. It follows the PC (LinkHub sets it from the PC's messages) and is
 * saved so the app opens in the right colours before it reconnects.
 */
object Look {
    var character by mutableStateOf("kulhi")
        private set
    var ruiLook by mutableStateOf("toy")
        private set
    var ruiTheme by mutableStateOf("cream")
        private set

    val accent: Color get() = Characters.accent(character, ruiTheme)

    /** Shows `id` (and Rui's look and colour). Unknown names are ignored. */
    fun show(id: String, look: String? = null, theme: String? = null) {
        if (Characters.all.none { it.id == id }) return
        character = id
        if (look != null && look in Characters.ruiLooks) ruiLook = look
        if (theme != null && theme in Characters.ruiThemes) ruiTheme = theme
    }
}
