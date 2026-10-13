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
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.deskcompanion.phone.R
import app.deskcompanion.phone.model.Characters
import app.deskcompanion.phone.model.Look
import app.deskcompanion.phone.model.Status

/**
 * The app's colours. Everything takes its tint from the chosen character's
 * accent (see [deskColors]); cards for what needs you are the accent itself.
 */
@Immutable
class DeskColors(
    val bg: Color,
    val surface: Color,
    val ink: Color,
    val inkSoft: Color,
    val line: Color,
    /** Text on an [ink] button. */
    val onInk: Color,
    /** Text on a tinted card. */
    val onCard: Color,
    val chip: Color,
    /** Tints of the accent: working, idle, "needs you" (small spots), and the two status colours. */
    val blue: Color,
    val lavender: Color,
    val peach: Color,
    val mint: Color,
    val rose: Color,
    /** The character's colour, and text on it. */
    val accent: Color,
    val onAccent: Color,
    /** Buttons sitting on a card. */
    val cardButton: Color,
    val onCardButton: Color,
    val dark: Boolean,
) {
    /** The card for a session: the accent itself when it needs you, a tint otherwise. */
    fun cardFor(s: Status): Color = when (s) {
        Status.Working -> blue
        Status.Waiting -> accent
        Status.Done -> mint
        Status.Error -> rose
        Status.Idle -> lavender
    }

    /** Text on that card. */
    fun onCardFor(s: Status): Color = if (s == Status.Waiting) onAccent else onCard
}

private fun mix(a: Color, b: Color, amountOfA: Float) = lerp(b, a, amountOfA)

/** The palette for a character's accent: a warm neutral base lightly tinted by it, or the dark version. */
fun deskColors(accent: Color, dark: Boolean): DeskColors {
    val white = Color(0xFFFFFFFF)
    return if (!dark) {
        DeskColors(
            bg = mix(accent, Color(0xFFFBFAF9), 0.07f), surface = white, ink = Color(0xFF1D1A1A), inkSoft = Color(0xFF7A7370),
            line = mix(accent, Color(0xFFE8E4E2), 0.14f), onInk = white, onCard = Color(0xFF1D1A1A),
            chip = mix(accent, white, 0.10f),
            blue = mix(accent, white, 0.28f), lavender = mix(accent, white, 0.10f), peach = mix(accent, white, 0.32f),
            mint = Color(0xFFCBEBDA), rose = Color(0xFFF8D2D2),
            accent = accent, onAccent = white, cardButton = Color(0xFF1D1A1A), onCardButton = white, dark = false,
        )
    } else {
        val base = Color(0xFF1C1A19)
        DeskColors(
            bg = mix(accent, Color(0xFF121110), 0.08f), surface = Color(0xFF262321), ink = Color(0xFFF4F1EF), inkSoft = Color(0xFFA39C98),
            line = mix(accent, Color(0xFF2A2726), 0.15f), onInk = Color(0xFF1D1A1A), onCard = Color(0xFFF4F1EF),
            chip = mix(accent, Color(0xFF232120), 0.18f),
            blue = mix(accent, base, 0.30f), lavender = mix(accent, base, 0.16f), peach = mix(accent, base, 0.40f),
            mint = Color(0xFF24473A), rose = Color(0xFF4F2A2E),
            accent = accent, onAccent = white, cardButton = Color(0xFFF4F1EF), onCardButton = Color(0xFF1D1A1A), dark = true,
        )
    }
}

val LocalDesk = staticCompositionLocalOf { deskColors(Characters.accent("kulhi", "cream"), dark = false) }

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
    val c = deskColors(Look.accent, dark)
    val scheme = if (dark) {
        darkColorScheme(background = c.bg, surface = c.surface, onSurface = c.ink, primary = c.ink, onPrimary = c.onInk)
    } else {
        lightColorScheme(background = c.bg, surface = c.surface, onSurface = c.ink, primary = c.ink, onPrimary = c.onInk)
    }
    CompositionLocalProvider(LocalDesk provides c) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
