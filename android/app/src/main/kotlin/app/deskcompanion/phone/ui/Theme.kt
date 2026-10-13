package app.deskcompanion.phone.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.deskcompanion.phone.R
import app.deskcompanion.phone.model.Status

/** The app's colours: calm surfaces, a few soft pastels for cards, near-black for buttons. */
@Immutable
class DeskColors(
    val bg: Color,
    val surface: Color,
    val ink: Color,
    val inkSoft: Color,
    val line: Color,
    /** Text on an [ink] button. */
    val onInk: Color,
    /** Text on a pastel card. */
    val onCard: Color,
    val chip: Color,
    val blue: Color,
    val lavender: Color,
    val peach: Color,
    val mint: Color,
    val rose: Color,
    val dark: Boolean,
) {
    /** Faces are always light with dark lines, and buttons on a pastel card always near-black, in either theme. */
    val face: Color get() = Color(0xFFFFFFFF)
    val faceInk: Color get() = Color(0xFF14151A)
    val cardButton: Color get() = Color(0xFF14151A)
    val onCardButton: Color get() = Color(0xFFFFFFFF)

    /** The pastel for a session's card. */
    fun cardFor(s: Status): Color = when (s) {
        Status.Working -> blue
        Status.Waiting -> peach
        Status.Done -> mint
        Status.Error -> rose
        Status.Idle -> lavender
    }
}

val LightDesk = DeskColors(
    bg = Color(0xFFF4F6FB), surface = Color(0xFFFFFFFF), ink = Color(0xFF14151A), inkSoft = Color(0xFF6B6F7B),
    line = Color(0xFFE6E8F0), onInk = Color(0xFFFFFFFF), onCard = Color(0xFF14151A), chip = Color(0xFFEBEEF7),
    blue = Color(0xFFA7BBFA), lavender = Color(0xFFD9CCFA), peach = Color(0xFFFFD2AB), mint = Color(0xFFC3EDD6),
    rose = Color(0xFFF9C9DA), dark = false,
)

val DarkDesk = DeskColors(
    bg = Color(0xFF101116), surface = Color(0xFF1A1B22), ink = Color(0xFFF2F3F8), inkSoft = Color(0xFF9A9EAD),
    line = Color(0xFF2A2C36), onInk = Color(0xFF14151A), onCard = Color(0xFF14151A), chip = Color(0xFF23252F),
    // The same pastels, a touch softer, on near-black: dark text on light cards.
    blue = Color(0xFF9AAEEE), lavender = Color(0xFFCBBEF0), peach = Color(0xFFF2C49E), mint = Color(0xFFB5DFC8),
    rose = Color(0xFFEDBCCD), dark = true,
)

val LocalDesk = staticCompositionLocalOf { LightDesk }

/** Shorthand: `Desk.colors.ink`. */
object Desk {
    val colors: DeskColors
        @Composable get() = LocalDesk.current
}

@OptIn(ExperimentalTextApi::class)
private fun outfit(weight: FontWeight) = Font(
    R.font.outfit,
    weight = weight,
    variationSettings = FontVariation.Settings(FontVariation.weight(weight.weight)),
)

val Outfit = FontFamily(
    outfit(FontWeight.Normal),
    outfit(FontWeight.Medium),
    outfit(FontWeight.SemiBold),
    outfit(FontWeight.Bold),
)

/** Text styles used across the screens. */
object DeskType {
    val display = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, lineHeight = 34.sp, letterSpacing = (-0.5).sp)
    val title = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 26.sp, letterSpacing = (-0.2).sp)
    val heading = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.SemiBold, fontSize = 17.sp, lineHeight = 22.sp)
    val body = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.Normal, fontSize = 15.sp, lineHeight = 21.sp)
    val bodyMedium = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 21.sp)
    val small = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 18.sp)
    val label = TextStyle(fontFamily = Outfit, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.3.sp)
    val mono = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Normal, fontSize = 13.sp, lineHeight = 19.sp)
}

@Composable
fun DeskTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val c = if (dark) DarkDesk else LightDesk
    val scheme = if (dark) {
        darkColorScheme(background = c.bg, surface = c.surface, onSurface = c.ink, primary = c.ink, onPrimary = c.onInk)
    } else {
        lightColorScheme(background = c.bg, surface = c.surface, onSurface = c.ink, primary = c.ink, onPrimary = c.onInk)
    }
    CompositionLocalProvider(LocalDesk provides c) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
