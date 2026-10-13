package app.deskcompanion.phone.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status
import kotlinx.coroutines.delay

/** How long the buttons ignore taps after the sheet appears, so a stray tap can't land on Allow. */
const val GUARD_MS = 600L

/**
 * The permission request a session is holding open. Allow is the near-black
 * button; Deny is the outlined one. [onAllow] is where the fingerprint check
 * will go.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ApprovalSheet(session: Session, live: Boolean, onAllow: () -> Unit, onDeny: () -> Unit, onDismiss: () -> Unit) {
    val c = Desk.colors
    val request = session.approval ?: return
    var armed by remember(session.id) { mutableStateOf(false) }
    LaunchedEffect(session.id) {
        delay(GUARD_MS)
        armed = true
    }
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = c.surface,
        shape = RoundedCornerShape(topStart = 34.dp, topEnd = 34.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp).navigationBarsPadding().padding(bottom = 20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(56.dp).clip(CircleShape).background(c.peach), contentAlignment = Alignment.Center) {
                    MoodOrb(Status.Waiting, size = 46.dp, fill = c.face, stroke = c.faceInk)
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text("${session.project} needs your OK", style = DeskType.heading, color = c.ink)
                    Text("${session.agent} wants to ${request.action}", style = DeskType.small, color = c.inkSoft)
                }
            }
            Spacer(Modifier.height(18.dp))
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(20.dp))
                    .background(c.chip)
                    .padding(16.dp),
            ) {
                Text(request.detail, style = DeskType.mono, color = c.ink)
            }
            Spacer(Modifier.height(22.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                PillButton("Deny", onClick = onDeny, filled = false, enabled = armed, modifier = Modifier.weight(1f), height = 54.dp)
                PillButton("Allow", onClick = onAllow, enabled = armed, modifier = Modifier.weight(1f), height = 54.dp)
            }
            Spacer(Modifier.height(10.dp))
            Text(
                if (live) "Your answer goes straight to the agent on your PC." else "A sample request: nothing is sent anywhere.",
                style = DeskType.small, color = c.inkSoft, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
