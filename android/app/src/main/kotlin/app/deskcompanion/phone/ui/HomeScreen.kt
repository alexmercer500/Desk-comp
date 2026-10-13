package app.deskcompanion.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Filter
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status
import androidx.compose.foundation.clickable

@Composable
fun HomeScreen(
    state: AppState,
    onOpen: (String) -> Unit,
    onReview: (String) -> Unit,
    onBell: () -> Unit,
    onLink: () -> Unit,
    padding: PaddingValues,
) {
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
        item { Header(state, onBell) }
        if (!state.live) {
            item {
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.surface).clickable(onClick = onLink).padding(horizontal = 18.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("These are samples", style = DeskType.bodyMedium, color = c.ink)
                        Text("Link your PC to see your own agents", style = DeskType.small, color = c.inkSoft)
                    }
                    Text("Link ›", style = DeskType.bodyMedium, color = c.ink)
                }
            }
        }
        item { Spacer(Modifier.height(4.dp)) }
        item {
            val hero = state.hero
            if (hero != null) HeroCard(hero, state, onOpen, onReview) else EmptyCard(state.live)
        }
        item {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (f in Filter.entries) FilterChip(f.label, state.filter == f, onClick = { state.filter = f })
            }
        }
        // The hero card already shows the top session; "All" lists the rest.
        val list = if (state.filter == Filter.All) state.visible.filter { it.id != state.hero?.id } else state.visible
        if (list.isEmpty()) {
            item { Text("Nothing here right now.", style = DeskType.body, color = c.inkSoft, modifier = Modifier.padding(vertical = 18.dp)) }
        }
        items(list, key = { it.id }) { s -> SessionCard(s, onClick = { onOpen(s.id) }) }
    }
}

@Composable
private fun Header(state: AppState, onBell: () -> Unit) {
    val c = Desk.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(52.dp).clip(CircleShape).background(c.blue), contentAlignment = Alignment.Center) {
            MoodOrb(if (state.waitingCount > 0) Status.Waiting else Status.Working, size = 42.dp)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text("Hello, Nidhi", style = DeskType.heading, color = c.ink)
            val line = when {
                state.waitingCount > 0 -> "${state.waitingCount} waiting for you"
                state.sessions.any { it.status == Status.Working } -> "Your agents are busy"
                else -> "All quiet"
            }
            Text(line, style = DeskType.small, color = c.inkSoft)
        }
        RoundIconButton(Icons.Filled.Notifications, "Notifications", onBell, dot = state.waitingCount > 0)
    }
}

/** The one session that most needs the user, as a big soft-blue card. */
@Composable
private fun HeroCard(s: Session, state: AppState, onOpen: (String) -> Unit, onReview: (String) -> Unit) {
    val c = Desk.colors
    val card = c.cardFor(s.status)
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(34.dp))
            .background(card)
            .clickable { onOpen(s.id) }
            .padding(22.dp),
    ) {
        // The face peeks in from the bottom corner, cropped by the card.
        MoodOrb(
            s.status, size = 112.dp,
            modifier = Modifier.align(Alignment.BottomEnd).offset(x = 30.dp, y = 34.dp),
        )
        Column(Modifier.align(Alignment.TopEnd), horizontalAlignment = Alignment.CenterHorizontally) {
            Ring(
                progress = state.doneToday.toFloat() / state.totalToday.coerceAtLeast(1),
                label = "${state.doneToday}/${state.totalToday}",
                color = c.onCardFor(s.status), track = c.onCardFor(s.status).copy(alpha = 0.15f), size = 50.dp,
            )
            Spacer(Modifier.height(4.dp))
            Text("done today", style = DeskType.label, color = c.onCardFor(s.status).copy(alpha = 0.6f))
        }
        Column(Modifier.padding(end = 96.dp)) {
            Text(statusWord(s.status).uppercase(), style = DeskType.label, color = c.onCardFor(s.status).copy(alpha = 0.7f))
            Spacer(Modifier.height(8.dp))
            Text(s.project, style = DeskType.title, color = c.onCardFor(s.status), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(4.dp))
            Text("${s.agent} · ${s.line}", style = DeskType.body, color = c.onCardFor(s.status).copy(alpha = 0.75f), maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(20.dp))
            val review = s.status == Status.Waiting
            PillButton(
                text = if (review) "Review" else "Open",
                onClick = { if (review) onReview(s.id) else onOpen(s.id) },
                modifier = Modifier.width(132.dp),
                container = c.cardButton, contentColor = c.onCardButton,
            )
        }
    }
}

@Composable
private fun EmptyCard(live: Boolean) {
    val c = Desk.colors
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(34.dp)).background(c.lavender).padding(24.dp),
        horizontalAlignment = Alignment.Start,
    ) {
        MoodOrb(Status.Idle, size = 72.dp)
        Spacer(Modifier.height(14.dp))
        Text(if (live) "All quiet" else "No agents yet", style = DeskType.title, color = c.onCard)
        Spacer(Modifier.height(4.dp))
        Text("Start Claude Code, Codex or another agent on your PC and it shows up here.", style = DeskType.body, color = c.onCard.copy(alpha = 0.75f))
    }
}
