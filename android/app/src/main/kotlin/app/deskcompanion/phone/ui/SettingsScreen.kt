package app.deskcompanion.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.border
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
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.PowerManager
import android.provider.Settings as AndroidSettings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Characters
import app.deskcompanion.phone.model.Look
import app.deskcompanion.phone.model.Status
import app.deskcompanion.phone.link.LinkHub
import app.deskcompanion.phone.update.Updater
import androidx.compose.runtime.collectAsState

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

        item { Group("Your name") }
        item { NameField(state) }

        item { Group("Character") }
        item { CharacterPicker() }

        item { Group("Tell me when") }
        item {
            Card {
                ToggleRow("A task finishes", "With a short summary of what it did", state.notifyDone) { state.changeNotifyDone(it) }
                Divider()
                ToggleRow("An agent needs me", "Permissions and questions", state.notifyNeedsYou) { state.changeNotifyNeedsYou(it) }
                Divider()
                ToggleRow("Something fails", "Errors and stops", state.notifyErrors) { state.changeNotifyErrors(it) }
                Divider()
                ToggleRow("Quiet hours", "Only urgent ones, 10 pm to 8 am", state.quietHours) { state.changeQuietHours(it) }
            }
        }

        item { Group("Staying linked") }
        item { Card { SleepRow() } }

        item { Group("Replying") }
        item {
            Card {
                ToggleRow(
                    "Away mode",
                    "Each Claude Code task that finishes waits up to 5 minutes for a reply from here. Using the PC's keyboard or mouse lets it go at once",
                    state.awayMode,
                ) { state.changeAwayMode(it) }
            }
        }

        item { Group("Safety") }
        item {
            Card {
                ToggleRow("Ask for my fingerprint before Allow", "And before answers and replies. Deny never asks", state.requireUnlockForAllow) { state.changeRequireUnlockForAllow(it) }
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

        if (Updater.enabled) {
            item { Group("Updates") }
            item { Card { UpdateRow() } }
        }

        item {
            Text("Desk Companion for Android ${Updater.installedName()}", style = DeskType.small, color = c.inkSoft, modifier = Modifier.padding(top = 10.dp, start = 6.dp))
        }
    }
}

/** The linked PC: whether it's connected, and the button to link or unlink. */
@Composable
private fun ComputerCard(link: LinkHub.State, onLink: () -> Unit, onUnlink: () -> Unit) {
    val c = Desk.colors
    val (label, title, detail, mood, color) = when (link) {
        LinkHub.State.Unpaired -> Card5("NOT LINKED", "Link your computer", "Until then, the sessions here are samples so you can try the app.", Status.Idle, c.lavender)
        is LinkHub.State.Connecting -> Card5(
            "CONNECTING", link.name,
            when {
                link.relay -> "Not on its network: reaching it through the relay…"
                link.searching -> "Its address changed: looking for it on this network…"
                else -> "Reaching your PC…"
            },
            Status.Working, c.blue,
        )
        is LinkHub.State.Connected -> Card5(
            "LINKED", link.name,
            (if (link.relayed) "Connected through the relay, encrypted end to end. " else "Connected. ") +
                if (link.approvals) "Requests can be answered from here." else "Allow / Deny is switched off on the PC.",
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
            MoodOrb(mood, size = 64.dp)
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
                checkedTrackColor = c.accent, checkedThumbColor = c.onAccent, checkedBorderColor = c.accent,
                uncheckedTrackColor = c.chip, uncheckedThumbColor = c.inkSoft, uncheckedBorderColor = c.line,
            ),
        )
    }
}

/** Your character: picked here or on the PC, the same one in both places. Rui also has a look and a colour. */
@Composable
private fun CharacterPicker() {
    val c = Desk.colors
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for (ch in Characters.all) {
                val on = Look.character == ch.id
                Column(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(20.dp))
                        .background(if (on) c.accent.copy(alpha = 0.16f) else c.surface)
                        .border(if (on) 2.dp else 1.dp, if (on) c.accent else c.line, RoundedCornerShape(20.dp))
                        .clickable(role = Role.RadioButton) { LinkHub.pickCharacter(ch.id) }
                        .padding(vertical = 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    CharacterPicture(ch.id, Status.Idle, 44.dp)
                    Text(ch.name, style = DeskType.label, color = c.ink, maxLines = 1)
                }
            }
        }
        if (Look.character == "rui") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                for (look in Characters.ruiLooks) {
                    Text(
                        look.replaceFirstChar { it.uppercase() }, style = DeskType.label,
                        color = if (Look.ruiLook == look) c.onAccent else c.ink,
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(if (Look.ruiLook == look) c.accent else c.surface)
                            .clickable { LinkHub.pickCharacter("rui", look = look) }
                            .padding(horizontal = 14.dp, vertical = 7.dp),
                    )
                }
                Spacer(Modifier.width(6.dp))
                for (theme in Characters.ruiThemes) {
                    Box(
                        Modifier
                            .size(26.dp)
                            .clip(CircleShape)
                            .background(Characters.accent("rui", theme))
                            .border(if (Look.ruiTheme == theme) 3.dp else 1.dp, if (Look.ruiTheme == theme) c.ink else c.line, CircleShape)
                            .clickable { LinkHub.pickCharacter("rui", theme = theme) },
                    )
                }
            }
        }
        Text("Changes on your PC too, and the app takes this character's colour.", style = DeskType.small, color = c.inkSoft)
    }
}

/**
 * Whether Android lets the link run while the phone sleeps. Without it, the
 * phone may stop talking to the PC after a while with the screen off (Doze),
 * and requests arrive only when you pick the phone up.
 */
@Composable
private fun SleepRow() {
    val c = Desk.colors
    val ctx = LocalContext.current
    val power = remember { ctx.getSystemService(PowerManager::class.java) }
    var allowed by remember { mutableStateOf(power.isIgnoringBatteryOptimizations(ctx.packageName)) }
    // Back from the system dialog: read it again.
    LifecycleResumeEffect(Unit) {
        allowed = power.isIgnoringBatteryOptimizations(ctx.packageName)
        onPauseOrDispose { }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(enabled = !allowed, role = Role.Button) { askToStayAwake(ctx) }
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text("Stay linked while the phone sleeps", style = DeskType.bodyMedium, color = c.ink)
            Text(
                if (allowed) "On. Requests reach you with the screen off."
                else "Off. Android may pause the link with the screen off, so requests can arrive late. Tap to allow.",
                style = DeskType.small, color = c.inkSoft,
            )
        }
        Spacer(Modifier.width(12.dp))
        Text(
            if (allowed) "On" else "Allow", style = DeskType.label,
            color = if (allowed) c.ink else c.onAccent,
            modifier = Modifier.clip(CircleShape).background(if (allowed) c.chip else c.accent).padding(horizontal = 14.dp, vertical = 8.dp),
        )
    }
}

private fun askToStayAwake(ctx: Context) {
    val ask = Intent(AndroidSettings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${ctx.packageName}"))
    try {
        ctx.startActivity(ask)
    } catch (e: Exception) {
        // Some phones hide that dialog: open the list instead.
        try {
            ctx.startActivity(Intent(AndroidSettings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        } catch (e: Exception) {
        }
    }
}

/** What Home calls you. Leave it empty to see the linked PC's name instead. */
@Composable
private fun NameField(state: AppState) {
    val c = Desk.colors
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.surface).padding(horizontal = 18.dp, vertical = 16.dp)) {
            if (state.displayName.isEmpty()) Text("Your name, or leave empty to show your PC's", style = DeskType.body, color = c.inkSoft)
            BasicTextField(
                value = state.displayName,
                onValueChange = { state.changeDisplayName(it) },
                singleLine = true,
                textStyle = DeskType.body.copy(color = c.ink),
                cursorBrush = SolidColor(c.ink),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Text("Shown at the top of Home.", style = DeskType.small, color = c.inkSoft)
    }
}

/** The version check: what is installed, whether there's a newer one, and the button to get it. */
@Composable
private fun UpdateRow() {
    val c = Desk.colors
    val ctx = LocalContext.current
    val u by Updater.state.collectAsState()
    val (title, detail) = when (val s = u) {
        is Updater.State.Available -> "Version ${s.info.versionName} is ready" to s.info.notes.ifBlank { "A newer version is available" }
        is Updater.State.Downloading -> "Downloading ${s.info.versionName}…" to "${s.percent}%"
        is Updater.State.NeedsPermission -> "Allow installs, then tap Update" to "Android asks once: switch on \"Allow from this source\", then come back"
        is Updater.State.Installing -> "Installing ${s.info.versionName}…" to "Confirm on Android's screen. The app restarts when it's done"
        is Updater.State.Failed -> "Update didn't finish" to s.message
        is Updater.State.Checking -> "Checking…" to "You have ${Updater.installedName()}"
        is Updater.State.UpToDate -> "You're up to date" to "Version ${Updater.installedName()}"
        else -> "Check for updates" to "You have ${Updater.installedName()}. It checks by itself when you open the app"
    }
    val canInstall = u is Updater.State.Available || u is Updater.State.NeedsPermission || (u as? Updater.State.Failed)?.info != null
    val busy = u is Updater.State.Checking || u is Updater.State.Downloading || u is Updater.State.Installing
    Column(Modifier.fillMaxWidth().padding(18.dp)) {
        Text(title, style = DeskType.bodyMedium, color = c.ink)
        Text(detail, style = DeskType.small, color = c.inkSoft, modifier = Modifier.padding(top = 2.dp))
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (canInstall) PillButton("Update", onClick = { Updater.install(ctx) }, modifier = Modifier.weight(1f), enabled = !busy)
            PillButton("Check now", onClick = { Updater.check(ctx) }, modifier = Modifier.weight(1f), filled = !canInstall, enabled = !busy)
        }
    }
}
