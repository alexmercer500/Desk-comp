package app.deskcompanion.phone.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.Peek

/**
 * Peek: a picture of a session's window on the PC, to see what it's asking.
 * Pinch or double-tap to zoom; Refresh takes a new one (the last stays up
 * until it arrives).
 */
@Composable
fun PeekScreen(project: String, peek: Peek?, onRefresh: () -> Unit, onBack: () -> Unit, padding: PaddingValues) {
    val c = Desk.colors
    val shown = when (peek) {
        is Peek.Ready -> peek
        is Peek.Loading -> peek.previous
        else -> null
    }
    val loading = peek is Peek.Loading
    Column(
        Modifier.fillMaxSize().padding(top = padding.calculateTopPadding() + 12.dp, bottom = padding.calculateBottomPadding() + 12.dp),
    ) {
        Row(Modifier.padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
            RoundIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", onBack)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(project, style = DeskType.title, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(shown?.title ?: "Its window on your PC", style = DeskType.small, color = c.inkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(10.dp))
            RoundIconButton(Icons.Filled.Refresh, "Take a new picture", onRefresh)
        }
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp).clip(RoundedCornerShape(22.dp)).background(Color(0xFF14151A)),
            contentAlignment = Alignment.Center,
        ) {
            if (shown != null) Zoomable(shown)
            when {
                loading -> Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(color = Color.White, strokeWidth = 3.dp, modifier = Modifier.size(36.dp))
                    if (shown == null) {
                        Spacer(Modifier.height(12.dp))
                        Text("Taking a picture of its window…", style = DeskType.body, color = Color.White.copy(alpha = 0.8f))
                    }
                }
                peek is Peek.Failed -> Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(peek.reason, style = DeskType.body, color = Color.White, textAlign = TextAlign.Center)
                    Spacer(Modifier.height(16.dp))
                    PillButton("Try again", onClick = onRefresh, container = Color.White, contentColor = Color(0xFF14151A), modifier = Modifier.width(150.dp))
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        val caption = when {
            shown != null -> "Taken ${agoText(shown.at)} · pinch or double-tap to zoom · only this window, never your whole screen"
            else -> "Only this window, never your whole screen. Your PC shows a notice each time."
        }
        Text(caption, style = DeskType.small, color = c.inkSoft, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp))
    }
}

/** The picture, fitted to the box; pinch to zoom and drag, double-tap to zoom in or back out. */
@Composable
private fun Zoomable(p: Peek.Ready) {
    var scale by remember(p) { mutableFloatStateOf(1f) }
    var offset by remember(p) { mutableStateOf(Offset.Zero) }
    val bitmap = remember(p) { p.image.asImageBitmap() }
    Image(
        bitmap = bitmap,
        contentDescription = "Picture of ${p.title}",
        contentScale = ContentScale.Fit,
        modifier = Modifier
            .fillMaxSize()
            .pointerInput(p) {
                detectTransformGestures { _, pan, zoom, _ ->
                    scale = (scale * zoom).coerceIn(1f, 6f)
                    offset = if (scale == 1f) Offset.Zero else offset + pan
                }
            }
            .pointerInput(p) {
                detectTapGestures(onDoubleTap = { tap ->
                    if (scale > 1f) {
                        scale = 1f
                        offset = Offset.Zero
                    } else {
                        // Zoom in on where you tapped.
                        scale = 2.5f
                        offset = Offset((size.width / 2f - tap.x) * 1.5f, (size.height / 2f - tap.y) * 1.5f)
                    }
                })
            }
            .graphicsLayer(scaleX = scale, scaleY = scale, translationX = offset.x, translationY = offset.y),
    )
}

private fun agoText(at: Long): String {
    val s = ((System.currentTimeMillis() - at) / 1000).coerceAtLeast(0)
    return when {
        s < 5 -> "just now"
        s < 60 -> "${s}s ago"
        else -> "${s / 60} min ago"
    }
}
