package app.deskcompanion.phone.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status

/** A pill-shaped button: filled near-black (the main action) or outlined. */
@Composable
fun PillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    filled: Boolean = true,
    enabled: Boolean = true,
    height: Dp = 48.dp,
    /** Set both on a pastel card, where buttons stay near-black in either theme. */
    container: Color? = null,
    contentColor: Color? = null,
) {
    val c = Desk.colors
    val shape = CircleShape
    val bg = container ?: c.ink
    val fg = contentColor ?: if (filled) c.onInk else c.ink
    Box(
        modifier
            .height(height)
            .alpha(if (enabled) 1f else 0.4f)
            .clip(shape)
            .then(if (filled) Modifier.background(bg) else Modifier.border(BorderStroke(1.5.dp, c.line), shape))
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
            .padding(horizontal = 22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = DeskType.bodyMedium, color = fg, maxLines = 1)
    }
}

/** A round button holding one icon, drawn as a soft outlined circle. */
@Composable
fun RoundIconButton(icon: ImageVector, description: String, onClick: () -> Unit, modifier: Modifier = Modifier, dot: Boolean = false) {
    val c = Desk.colors
    Box(
        modifier
            .size(46.dp)
            .clip(CircleShape)
            .background(c.surface)
            .border(1.dp, c.line, CircleShape)
            .clickable(role = Role.Button, onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = c.ink, modifier = Modifier.size(22.dp))
        if (dot) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .padding(top = 9.dp, end = 10.dp)
                    .size(9.dp)
                    .clip(CircleShape)
                    .background(Color(0xFFFF6B3D)),
            )
        }
    }
}

/** A filter chip: black when chosen, soft grey otherwise. */
@Composable
fun FilterChip(text: String, selected: Boolean, onClick: () -> Unit) {
    val c = Desk.colors
    Box(
        Modifier
            .clip(CircleShape)
            .background(if (selected) c.ink else c.surface)
            .border(1.dp, if (selected) c.ink else c.line, CircleShape)
            .clickable(role = Role.Tab, onClick = onClick)
            .padding(horizontal = 18.dp, vertical = 11.dp),
    ) {
        Text(text, style = DeskType.bodyMedium, color = if (selected) c.onInk else c.ink, maxLines = 1)
    }
}

/** A circular progress ring with a short label inside, like "2/3". */
@Composable
fun Ring(progress: Float, label: String, modifier: Modifier = Modifier, size: Dp = 56.dp, color: Color, track: Color) {
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(size)) {
            val w = 4.dp.toPx()
            val inset = w / 2f
            val arc = Size(this.size.width - w, this.size.height - w)
            drawArc(track, 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            drawArc(color, -90f, 360f * progress.coerceIn(0f, 1f), false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        Text(label, style = DeskType.label, color = color)
    }
}

/** The word shown for a status. */
fun statusWord(s: Status): String = when (s) {
    Status.Working -> "Working"
    Status.Waiting -> "Needs your OK"
    Status.Done -> "Done"
    Status.Error -> "Stopped"
    Status.Idle -> "Idle"
}

/** "3 min ago" for a session: from the PC's time when linked, else the sample's. */
fun agoOf(s: Session, now: Long = System.currentTimeMillis()): String =
    ago(if (s.updatedAt > 0) ((now - s.updatedAt) / 60_000).toInt().coerceAtLeast(0) else s.minutesAgo)

fun ago(minutes: Int): String = when {
    minutes < 1 -> "just now"
    minutes < 60 -> "$minutes min ago"
    else -> "${minutes / 60} h ago"
}

/** A session as a pastel card: the agent's badge, the project, what it's doing, and an arrow. */
@Composable
fun SessionCard(session: Session, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val c = Desk.colors
    val card = c.cardFor(session.status)
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(30.dp))
            .background(card)
            .clickable(role = Role.Button, onClick = onClick)
            .padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MoodOrb(session.status, size = 52.dp)
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(session.project, style = DeskType.heading, color = c.onCardFor(session.status), maxLines = 1, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(2.dp))
            Text(
                "${session.agent} · ${statusWord(session.status)}",
                style = DeskType.small,
                color = c.onCardFor(session.status).copy(alpha = 0.7f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Spacer(Modifier.width(10.dp))
        Box(Modifier.size(44.dp).clip(CircleShape).background(c.cardButton), contentAlignment = Alignment.Center) {
            Icon(Icons.AutoMirrored.Filled.ArrowForward, contentDescription = "Open ${session.project}", tint = c.onCardButton, modifier = Modifier.size(20.dp))
        }
    }
}

enum class Tab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home),
    Activity("Activity", Icons.Filled.DateRange),
    Settings("Settings", Icons.Filled.Settings),
}

/** The floating dark bar at the bottom, with the chosen tab lit. */
@Composable
fun NavBar(selected: Tab, onSelect: (Tab) -> Unit, badge: Int, modifier: Modifier = Modifier) {
    val c = Desk.colors
    // Always the dark ink pill, as in the references; icons flip with the theme.
    val pill = if (c.dark) Color(0xFF2B2826) else Color(0xFF1D1A1A)
    Row(
        modifier
            .clip(RoundedCornerShape(34.dp))
            .background(pill)
            .padding(8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for (tab in Tab.entries) {
            val on = tab == selected
            Box(
                Modifier
                    .size(width = 74.dp, height = 52.dp)
                    .clip(RoundedCornerShape(26.dp))
                    .background(if (on) c.accent else Color.Transparent)
                    .clickable(role = Role.Tab, onClick = { onSelect(tab) })
                    .semantics { contentDescription = tab.label },
                contentAlignment = Alignment.Center,
            ) {
                Icon(tab.icon, contentDescription = null, tint = if (on) c.onAccent else Color.White.copy(alpha = 0.7f), modifier = Modifier.size(24.dp))
                if (tab == Tab.Home && badge > 0) {
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            .padding(top = 8.dp, end = 14.dp)
                            .size(9.dp)
                            .clip(CircleShape)
                            .background(Color(0xFFFF6B3D)),
                    )
                }
            }
        }
    }
}
