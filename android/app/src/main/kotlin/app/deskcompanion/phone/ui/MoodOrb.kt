package app.deskcompanion.phone.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.Status
import kotlin.math.PI
import kotlin.math.sin

/**
 * A round face that shows how a session is doing, drawn in a few strokes:
 * working (eyes on the task, bobbing), waiting (wide eyes, a small "o"),
 * done (happy arcs), error (flat eyes, a frown) and idle (eyes closed).
 */
@Composable
fun MoodOrb(status: Status, modifier: Modifier = Modifier, size: Dp = 96.dp, fill: Color = Color.White, stroke: Color = Color(0xFF14151A)) {
    val loop = rememberInfiniteTransition(label = "orb")
    val t by loop.animateFloat(0f, 1f, infiniteRepeatable(tween(3600, easing = LinearEasing), RepeatMode.Restart), label = "t")
    val bob = if (status == Status.Idle || status == Status.Error) 0f else sin(t * 2f * PI.toFloat())
    // A short blink near the end of each cycle (not while the eyes are drawn as arcs).
    val blink = t in 0.92f..0.96f

    Canvas(modifier.size(size)) {
        val r = this.size.minDimension / 2f
        val c = Offset(this.size.width / 2f, this.size.height / 2f + bob * r * 0.03f)
        drawCircle(fill, radius = r, center = c)
        face(status, c, r, stroke, blink, t)
    }
}

private fun DrawScope.face(status: Status, c: Offset, r: Float, ink: Color, blink: Boolean, t: Float) {
    val w = r * 0.075f
    val line = Stroke(width = w, cap = StrokeCap.Round)
    val eyeY = c.y - r * 0.12f
    val dx = r * 0.3f
    val left = Offset(c.x - dx, eyeY)
    val right = Offset(c.x + dx, eyeY)

    fun dot(at: Offset, radius: Float) = drawCircle(ink, radius = radius, center = at)
    fun arc(at: Offset, up: Boolean) {
        val p = Path().apply {
            moveTo(at.x - r * 0.11f, at.y + (if (up) r * 0.04f else -r * 0.04f))
            quadraticTo(at.x, at.y + (if (up) -r * 0.12f else r * 0.12f), at.x + r * 0.11f, at.y + (if (up) r * 0.04f else -r * 0.04f))
        }
        drawPath(p, ink, style = line)
    }
    fun eyes(radius: Float, shiftX: Float = 0f, shiftY: Float = 0f) {
        if (blink) {
            for (e in listOf(left, right)) drawLine(ink, Offset(e.x - radius, e.y), Offset(e.x + radius, e.y), strokeWidth = w, cap = StrokeCap.Round)
        } else {
            dot(Offset(left.x + shiftX, left.y + shiftY), radius)
            dot(Offset(right.x + shiftX, right.y + shiftY), radius)
        }
    }

    when (status) {
        Status.Working -> {
            // Looking up and to one side, with a little thinking mouth.
            eyes(r * 0.065f, shiftX = r * 0.04f, shiftY = -r * 0.03f)
            val m = Path().apply {
                moveTo(c.x - r * 0.14f, c.y + r * 0.34f)
                quadraticTo(c.x, c.y + r * 0.34f + sin(t * 2f * PI.toFloat() * 2f) * r * 0.03f, c.x + r * 0.14f, c.y + r * 0.34f)
            }
            drawPath(m, ink, style = line)
        }
        Status.Waiting -> {
            eyes(r * 0.085f)
            drawCircle(ink, radius = r * 0.07f, center = Offset(c.x, c.y + r * 0.36f), style = line)
        }
        Status.Done -> {
            arc(left, up = true)
            arc(right, up = true)
            val m = Path().apply {
                moveTo(c.x - r * 0.28f, c.y + r * 0.22f)
                quadraticTo(c.x, c.y + r * 0.56f, c.x + r * 0.28f, c.y + r * 0.22f)
            }
            drawPath(m, ink, style = line)
        }
        Status.Error -> {
            for (e in listOf(left, right)) drawLine(ink, Offset(e.x - r * 0.07f, e.y), Offset(e.x + r * 0.07f, e.y), strokeWidth = w, cap = StrokeCap.Round)
            val m = Path().apply {
                moveTo(c.x - r * 0.2f, c.y + r * 0.42f)
                quadraticTo(c.x, c.y + r * 0.28f, c.x + r * 0.2f, c.y + r * 0.42f)
            }
            drawPath(m, ink, style = line)
        }
        Status.Idle -> {
            arc(left, up = false)
            arc(right, up = false)
            drawLine(ink, Offset(c.x - r * 0.1f, c.y + r * 0.36f), Offset(c.x + r * 0.1f, c.y + r * 0.36f), strokeWidth = w, cap = StrokeCap.Round)
        }
    }
}
