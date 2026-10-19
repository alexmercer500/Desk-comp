package app.deskcompanion.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Ask
import app.deskcompanion.phone.model.FileChange
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status
import app.deskcompanion.phone.model.Step
import androidx.compose.foundation.clickable

@Composable
fun SessionScreen(
    state: AppState,
    id: String,
    onBack: () -> Unit,
    onReview: (String) -> Unit,
    /** Sends a reply; calls `sent` once it's on its way (after the fingerprint check, if any). */
    onReply: (id: String, text: String, sent: () -> Unit) -> Unit,
    /** Peek at its window on the PC; null when that can't be done right now (not linked). */
    onPeek: ((String) -> Unit)?,
    padding: PaddingValues,
) {
    val c = Desk.colors
    val s = state.session(id)
    if (s == null) {
        onBack()
        return
    }
    Box(Modifier.fillMaxSize()) {
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 20.dp, end = 20.dp,
                top = padding.calculateTopPadding() + 12.dp,
                bottom = padding.calculateBottomPadding() + if (s.status == Status.Done || s.reply != null) 190.dp else 40.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RoundIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", onBack)
                    Spacer(Modifier.width(14.dp))
                    Text(s.project, style = DeskType.title, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            item { StatusCard(s, onReview) }
            if (onPeek != null) {
                item {
                    PillButton(
                        "Peek at its window",
                        onClick = { onPeek(s.id) },
                        filled = false,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            if (s.ask != null) {
                item { AskSection(s.ask, canReply = state.canReply(s)) }
            }
            if (s.prompt != null) {
                item { Section("You asked") { Text(s.prompt, style = DeskType.body, color = c.ink) } }
            }
            if (s.summary != null) {
                item { Section("What it said") { Text(s.summary, style = DeskType.body, color = c.ink) } }
            }
            if (s.files.isNotEmpty()) {
                item {
                    Section("Files changed (${s.files.size})") {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { for (f in s.files) FileRow(f) }
                    }
                }
            }
            if (s.steps.isNotEmpty()) {
                item {
                    Section("What it did (${s.steps.size} steps)") {
                        Column {
                            s.steps.forEachIndexed { i, st -> StepRow(st, last = i == s.steps.lastIndex) }
                        }
                    }
                }
            }
        }
        if (s.status == Status.Done || s.reply != null) {
            // A solid dock with a short fade above it, so the list scrolls away underneath
            // and never shows through the hint or the box.
            Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth()) {
                Box(Modifier.fillMaxWidth().height(24.dp).background(Brush.verticalGradient(listOf(c.bg.copy(alpha = 0f), c.bg))))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .background(c.bg)
                        .imePadding()
                        .padding(start = 16.dp, end = 16.dp, top = 2.dp, bottom = padding.calculateBottomPadding() + 12.dp),
                ) {
                    ReplyBar(
                        hint = replyHint(state, s),
                        open = state.canReply(s),
                        onSend = { text, sent -> onReply(s.id, text, sent) },
                    )
                }
            }
        }
    }
}

@Composable
private fun StatusCard(s: Session, onReview: (String) -> Unit) {
    val c = Desk.colors
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(c.cardFor(s.status)).padding(20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(statusWord(s.status).uppercase(), style = DeskType.label, color = c.onCardFor(s.status).copy(alpha = 0.7f))
            Spacer(Modifier.height(6.dp))
            Text(s.line, style = DeskType.heading, color = c.onCardFor(s.status))
            Spacer(Modifier.height(4.dp))
            Text("${s.agent} · ${agoOf(s)}", style = DeskType.small, color = c.onCardFor(s.status).copy(alpha = 0.7f))
            // Only something that can be answered from here gets a button.
            if (s.status == Status.Waiting && (s.approval != null || s.question != null)) {
                Spacer(Modifier.height(16.dp))
                PillButton("Review", onClick = { onReview(s.id) }, modifier = Modifier.width(120.dp), container = c.cardButton, contentColor = c.onCardButton)
            }
        }
        Spacer(Modifier.width(12.dp))
        MoodOrb(s.status, size = 84.dp)
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val c = Desk.colors
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(c.surface).padding(18.dp)) {
        Text(title, style = DeskType.label, color = c.inkSoft)
        Spacer(Modifier.height(8.dp))
        content()
    }
}

/** What it's asking on the PC, with its choices: answered there (or with a reply from here, when one gets through). */
@Composable
private fun AskSection(ask: Ask, canReply: Boolean) {
    val c = Desk.colors
    Section(ask.headline ?: "It's asking") {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (q in ask.items) {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(q.question, style = DeskType.bodyMedium, color = c.ink)
                    for (o in q.options) {
                        Text("• ${o.label}", style = DeskType.body, color = c.ink)
                        if (o.description != null) Text(o.description, style = DeskType.small, color = c.inkSoft, modifier = Modifier.padding(start = 12.dp))
                    }
                }
            }
            val hint = if (canReply) "Pick one in ${ask.where} on your PC, or tell it what you want below." else "Pick one in ${ask.where} on your PC."
            Text(hint, style = DeskType.small, color = c.inkSoft)
        }
    }
}

/** One step on a little timeline: a dot, a line down to the next one, the tool and what it touched. */
@Composable
private fun StepRow(st: Step, last: Boolean) {
    val c = Desk.colors
    val red = Color(0xFFD64B3A)
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Box(Modifier.width(20.dp).fillMaxHeight(), contentAlignment = Alignment.TopCenter) {
            if (!last) Box(Modifier.padding(top = 14.dp).width(2.dp).fillMaxHeight().background(c.line))
            Box(Modifier.padding(top = 6.dp).size(10.dp).clip(CircleShape).background(if (st.failed) red else c.ink))
        }
        Spacer(Modifier.width(10.dp))
        Column(Modifier.padding(bottom = if (last) 0.dp else 14.dp)) {
            Text(st.tool, style = DeskType.bodyMedium, color = if (st.failed) red else c.ink)
            Text(st.detail, style = DeskType.mono, color = c.inkSoft, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun FileRow(f: FileChange) {
    val c = Desk.colors
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(f.path, style = DeskType.mono, color = c.ink, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
        Spacer(Modifier.width(10.dp))
        Text("+${f.add}", style = DeskType.label, color = Color(0xFF2E8B57))
        Spacer(Modifier.width(6.dp))
        Text("−${f.del}", style = DeskType.label, color = Color(0xFFD64B3A))
    }
}

/** What the reply box says about whether a reply would get through. */
private fun replyHint(state: AppState, s: Session): String {
    val hold = s.reply
    return when {
        !state.live -> "A sample session: try a reply."
        hold != null -> {
            val left = ((hold.until - System.currentTimeMillis()) / 60_000).coerceAtLeast(0)
            if (left >= 1) "Your PC is waiting for your reply for about $left more min." else "Your PC is waiting for your reply for a moment longer."
        }
        !state.awayMode -> "Away mode is off: turn it on in Settings to reply from here."
        else -> "This one finished before it could wait. With Away mode on, the next Claude Code or Command Code task waits for your reply."
    }
}

/** A text box with a round send button, for a further prompt once a task is done. */
@Composable
private fun ReplyBar(hint: String, open: Boolean, onSend: (String, () -> Unit) -> Unit, modifier: Modifier = Modifier) {
    val c = Desk.colors
    var text by remember { mutableStateOf("") }
    val ready = open && text.isNotBlank()
    Column(modifier.fillMaxWidth()) {
        Text(hint, style = DeskType.small, color = c.inkSoft, modifier = Modifier.padding(start = 12.dp, bottom = 6.dp))
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(32.dp)).background(c.surface).padding(start = 20.dp, end = 8.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (text.isEmpty()) Text("Give it a further prompt…", style = DeskType.body, color = c.inkSoft)
                BasicTextField(
                    value = text,
                    onValueChange = { text = it.take(4000) },
                    textStyle = DeskType.body.copy(color = c.ink),
                    cursorBrush = SolidColor(c.ink),
                    maxLines = 4,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Box(
                Modifier.size(46.dp).clip(CircleShape).background(if (ready) c.ink else c.line)
                    .clickable(enabled = ready) { onSend(text) { text = "" } },
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Send", tint = if (ready) c.onInk else c.inkSoft, modifier = Modifier.size(20.dp))
            }
        }
    }
}
