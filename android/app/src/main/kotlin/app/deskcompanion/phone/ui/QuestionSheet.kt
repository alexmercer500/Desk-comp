package app.deskcompanion.phone.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.QuestionItem
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status
import kotlinx.coroutines.delay

/** Longest answer typed by hand (the PC allows the same). */
private const val MAX_OTHER = 500

/**
 * Claude's question card: tap an option (or several, where it allows), or
 * "Other…" to type an answer. Send is ready once every question has one.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuestionSheet(session: Session, live: Boolean, onSend: (Map<String, String>) -> Unit, onDismiss: () -> Unit) {
    val c = Desk.colors
    val card = session.question ?: return
    // Per question: the picked labels, and typed text when "Other…" is picked.
    val picked = remember(card.rid) { mutableStateMapOf<String, Set<String>>() }
    val typed = remember(card.rid) { mutableStateMapOf<String, String>() }
    val other = remember(card.rid) { mutableStateMapOf<String, Boolean>() }
    var armed by remember(card.rid) { mutableStateOf(false) }
    LaunchedEffect(card.rid) {
        delay(GUARD_MS)
        armed = true
    }

    fun answerFor(q: QuestionItem): String? =
        if (other[q.question] == true) typed[q.question]?.trim()?.takeIf { it.isNotEmpty() }
        else picked[q.question]?.takeIf { it.isNotEmpty() }?.let { set -> q.options.map { it.label }.filter { it in set }.joinToString(", ") }

    val answers = card.items.mapNotNull { q -> answerFor(q)?.let { q.question to it } }.toMap()
    val ready = answers.size == card.items.size

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.surface,
        shape = RoundedCornerShape(topStart = 34.dp, topEnd = 34.dp),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 24.dp)
                .navigationBarsPadding()
                .padding(bottom = 20.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(c.lavender), contentAlignment = Alignment.Center) {
                    MoodOrb(Status.Waiting, size = 46.dp)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text("${session.project} has a question", style = DeskType.heading, color = c.ink)
                    Text("${session.agent} is waiting for your answer", style = DeskType.small, color = c.inkSoft)
                }
            }
            for (q in card.items) {
                Spacer(Modifier.height(20.dp))
                q.header?.let { Text(it.uppercase(), style = DeskType.label, color = c.inkSoft) }
                Spacer(Modifier.height(4.dp))
                Text(q.question, style = DeskType.bodyMedium, color = c.ink)
                if (q.multiSelect) Text("Pick any that apply", style = DeskType.small, color = c.inkSoft)
                Spacer(Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val mine = picked[q.question].orEmpty()
                    val typing = other[q.question] == true
                    for (o in q.options) {
                        OptionCard(o.label, o.description, selected = !typing && o.label in mine, enabled = armed) {
                            other[q.question] = false
                            picked[q.question] = when {
                                !q.multiSelect -> setOf(o.label)
                                o.label in mine -> mine - o.label
                                else -> mine + o.label
                            }
                        }
                    }
                    OptionCard("Other…", "Type your own answer", selected = typing, enabled = armed) {
                        other[q.question] = !typing
                    }
                    if (typing) {
                        val text = typed[q.question].orEmpty()
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(c.chip).padding(14.dp)) {
                            if (text.isEmpty()) Text("Your answer…", style = DeskType.body, color = c.inkSoft)
                            BasicTextField(
                                value = text,
                                // One line, as the PC expects.
                                onValueChange = { typed[q.question] = it.replace('\n', ' ').take(MAX_OTHER) },
                                textStyle = DeskType.body.copy(color = c.ink),
                                cursorBrush = SolidColor(c.ink),
                                maxLines = 4,
                                modifier = Modifier.fillMaxWidth(),
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(22.dp))
            PillButton(
                if (card.items.size > 1) "Send answers" else "Send answer",
                onClick = { onSend(answers) },
                enabled = armed && ready,
                modifier = Modifier.fillMaxWidth(),
                height = 54.dp,
            )
            Spacer(Modifier.height(10.dp))
            Text(
                if (live) "Your answer goes straight to the agent on your PC." else "A sample question: nothing is sent anywhere.",
                style = DeskType.small, color = c.inkSoft, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun OptionCard(label: String, description: String?, selected: Boolean, enabled: Boolean, onClick: () -> Unit) {
    val c = Desk.colors
    val shape = RoundedCornerShape(18.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (selected) c.ink else c.chip)
            .then(if (selected) Modifier else Modifier.border(BorderStroke(1.dp, c.line), shape))
            .clickable(enabled = enabled, role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(label, style = DeskType.bodyMedium, color = if (selected) c.onInk else c.ink)
        description?.let { Text(it, style = DeskType.small, color = if (selected) c.onInk.copy(alpha = 0.75f) else c.inkSoft) }
    }
}
