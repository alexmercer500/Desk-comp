package app.deskcompanion.phone.ui

import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Status

/** Today at a glance, and what was decided from this phone. */
@Composable
fun ActivityScreen(state: AppState, padding: PaddingValues) {
    val c = Desk.colors
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(
            start = 20.dp, end = 20.dp,
            top = padding.calculateTopPadding() + 12.dp,
            bottom = padding.calculateBottomPadding() + 110.dp,
        ),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item { Text("Activity", style = DeskType.display, color = c.ink, modifier = Modifier.padding(top = 6.dp)) }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Stat("Done", state.sessions.count { it.status == Status.Done }.toString(), c.mint, Modifier.weight(1f))
                Stat("Working", state.sessions.count { it.status == Status.Working }.toString(), c.blue, Modifier.weight(1f))
                Stat("Needs you", state.sessions.count { it.status == Status.Waiting || it.status == Status.Error }.toString(), c.peach, Modifier.weight(1f))
            }
        }
        item { Text("Decided from this phone", style = DeskType.heading, color = c.ink, modifier = Modifier.padding(top = 8.dp)) }
        if (state.decisions.isEmpty()) {
            item { Text("Nothing yet. Allow or deny a request and it shows up here.", style = DeskType.body, color = c.inkSoft) }
        }
        items(state.decisions) { d ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.surface).padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(
                    Modifier.size(40.dp).clip(CircleShape).background(if (d.allowed) c.mint else c.rose),
                    contentAlignment = Alignment.Center,
                ) { Text(if (d.allowed) "✓" else "✕", style = DeskType.heading, color = c.onCard) }
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text("${if (d.allowed) "Allowed" else "Denied"} · ${d.project}", style = DeskType.bodyMedium, color = c.ink)
                    Text(d.what, style = DeskType.mono, color = c.inkSoft, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun Stat(label: String, value: String, color: androidx.compose.ui.graphics.Color, modifier: Modifier) {
    val c = Desk.colors
    Column(modifier.clip(RoundedCornerShape(26.dp)).background(color).padding(16.dp)) {
        Text(value, style = DeskType.display, color = c.onCard)
        Spacer(Modifier.height(2.dp))
        Text(label, style = DeskType.small, color = c.onCard.copy(alpha = 0.75f), maxLines = 1)
    }
}
