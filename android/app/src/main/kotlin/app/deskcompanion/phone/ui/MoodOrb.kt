package app.deskcompanion.phone.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.R
import app.deskcompanion.phone.model.Characters
import app.deskcompanion.phone.model.Look
import app.deskcompanion.phone.model.Status
import kotlin.math.PI
import kotlin.math.sin

/**
 * The character you chose on your PC, in the mood of this session: working,
 * waiting for you (calling), done, stopped (drooping) or idle. Floats gently
 * unless it is stopped or idle. The pictures are made from the desktop's own
 * drawings (scripts/make-phone-pictures.mjs).
 */
@Composable
fun MoodOrb(status: Status, modifier: Modifier = Modifier, size: Dp = 96.dp) = CharacterPicture(Look.character, status, size, modifier)

/** A given character in a mood (the picker shows all of them; everything else shows the chosen one). */
@Composable
fun CharacterPicture(character: String, status: Status, size: Dp, modifier: Modifier = Modifier, outfit: String = Look.dogeshOutfit) {
    val ctx = LocalContext.current
    val name = Characters.picture(character, Look.ruiLook, Look.ruiTheme, status, outfit)
    val id = remember(name) { ctx.resources.getIdentifier(name, "drawable", ctx.packageName).takeIf { it != 0 } ?: R.drawable.char_kulhi_idle }
    val loop = rememberInfiniteTransition(label = "float")
    val t by loop.animateFloat(0f, 1f, infiniteRepeatable(tween(3600, easing = LinearEasing), RepeatMode.Restart), label = "t")
    val bob = if (status == Status.Idle || status == Status.Error) 0f else sin(t * 2f * PI.toFloat())
    Image(
        painter = painterResource(id),
        contentDescription = null,
        contentScale = ContentScale.Fit,
        modifier = modifier.size(size).graphicsLayer { translationY = bob * this.size.height * 0.025f },
    )
}
