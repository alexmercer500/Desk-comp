package app.deskcompanion.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Status
import app.deskcompanion.phone.link.LinkHub

@Composable
fun SettingsScreen(state: AppState, link: LinkHub.State, onLink: () -> Unit, onUnlink: () -> Unit, onTestNotification: () -> Unit, padding: PaddingValues) {
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
        item { Text("Settings", style = DeskType.display, color = c.ink, modifier = Modifier.padding(top = 6.dp)) }

        item { ComputerCard(link, onLink, onUnlink) }

        item { Group("Tell me when") }
        item {
            Card {
                ToggleRow("A task finishes", "With a short summary of what it did", state.notifyDone) { state.notifyDone = it }
                Divider()
                ToggleRow("An agent needs me", "Permissions and questions", state.notifyNeedsYou) { state.notifyNeedsYou = it }
                Divider()
                ToggleRow("Something fails", "Errors and stops", state.notifyErrors) { state.notifyErrors = it }
                Divider()
                ToggleRow("Quiet hours", "Only urgent ones, 10 pm to 8 am", state.quietHours) { state.quietHours = it }
            }
        }

        item { Group("Replying") }
        item {
            Card {
                ToggleRow(
                    "Away mode",
                    "When a task finishes, wait a few minutes for a reply from here",
                    state.awayMode,
                ) { state.awayMode = it }
            }
        }

        item { Group("Safety") }
        item {
            Card {
                ToggleRow("Ask for my fingerprint before Allow", "Deny never asks", state.requireUnlockForAllow) { state.requireUnlockForAllow = it }
            }
        }

        item { Group("Try it") }
        item {
            Card {
                Row(
                    Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onTestNotification).padding(18.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text("Send a test notification", style = DeskType.bodyMedium, color = c.ink)
                        Text("See what an approval looks like on your lock screen", style = DeskType.small, color = c.inkSoft)
                    }
                    Box(Modifier.size(38.dp).clip(CircleShape).background(c.ink), contentAlignment = Alignment.Center) {
                        Text("›", style = DeskType.heading, color = c.onInk)
                    }
                }
            }
        }

        item {
            Text("Desk Companion for Android 0.1.0", style = DeskType.small, color = c.inkSoft, modifier = Modifier.padding(top = 10.dp, start = 6.dp))
        }
    }
}

/** The linked PC: whether it's connected, and the button to link or unlink. */
@Composable
private fun ComputerCard(link: LinkHub.State, onLink: () -> Unit, onUnlink: () -> Unit) {
    val c = Desk.colors
    val (label, title, detail, mood, color) = when (link) {
        LinkHub.State.Unpaired -> Card5("NOT LINKED", "Link your computer", "Until then, the sessions here are samples so you can try the app.", Status.Idle, c.lavender)
        is LinkHub.State.Connecting -> Card5("CONNECTING", link.name, "Reaching your PC…", Status.Working, c.blue)
        is LinkHub.State.Connected -> Card5(
            "LINKED", link.name,
            if (link.approvals) "Connected. Requests can be answered from here." else "Connected. Allow / Deny is switched off on the PC.",
            Status.Done, c.mint,
        )
        is LinkHub.State.Retrying -> Card5("RECONNECTING", link.name, link.reason, Status.Waiting, c.peach)
        is LinkHub.State.Unlinked -> Card5("UNLINKED", link.name, "The PC made a new pairing code. Scan it to link again.", Status.Error, c.rose)
    }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(color).padding(20.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(label, style = DeskType.label, color = c.onCard.copy(alpha = 0.7f))
                Spacer(Modifier.height(6.dp))
                Text(title, style = DeskType.heading, color = c.onCard)
                Spacer(Modifier.height(4.dp))
                Text(detail, style = DeskType.small, color = c.onCard.copy(alpha = 0.75f))
            }
            Spacer(Modifier.width(12.dp))
            MoodOrb(mood, size = 64.dp, fill = c.face, stroke = c.faceInk)
        }
        Spacer(Modifier.height(16.dp))
        val unpaired = link is LinkHub.State.Unpaired
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (unpaired || link is LinkHub.State.Unlinked) {
                PillButton("Link a computer", onClick = onLink, container = c.cardButton, contentColor = c.onCardButton)
            }
            if (!unpaired) PillButton("Unlink", onClick = onUnlink, filled = false)
        }
    }
}

private data class Card5(val label: String, val title: String, val detail: String, val mood: Status, val color: androidx.compose.ui.graphics.Color)

@Composable
private fun Group(title: String) {
    Text(title, style = DeskType.heading, color = Desk.colors.ink, modifier = Modifier.padding(top = 8.dp, start = 4.dp))
}

@Composable
private fun Card(content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Desk.colors.surface)) { content() }
}

@Composable
private fun Divider() {
    Box(Modifier.fillMaxWidth().padding(horizontal = 18.dp).height(1.dp).background(Desk.colors.line))
}

@Composable
private fun ToggleRow(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    val c = Desk.colors
    Row(
        Modifier.fillMaxWidth().clickable(role = Role.Switch) { onChange(!checked) }.padding(horizontal = 18.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = DeskType.bodyMedium, color = c.ink)
            Text(subtitle, style = DeskType.small, color = c.inkSoft)
        }
        Spacer(Modifier.width(12.dp))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(
                checkedTrackColor = c.ink, checkedThumbColor = c.onInk,
                uncheckedTrackColor = c.chip, uncheckedThumbColor = c.inkSoft, uncheckedBorderColor = c.line,
            ),
        )
    }
}
