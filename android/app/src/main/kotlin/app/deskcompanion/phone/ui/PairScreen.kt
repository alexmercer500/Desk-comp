package app.deskcompanion.phone.ui

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import app.deskcompanion.phone.link.Pairing
import app.deskcompanion.phone.model.Status

/**
 * Linking a computer: scan the code from the PC's Settings → Phone, or paste
 * the link. Every way in ends at a confirmation naming the PC; nothing is
 * saved until the user taps Link.
 */
@Composable
fun PairScreen(start: Pairing?, onPair: (Pairing) -> Unit, onBack: () -> Unit, padding: PaddingValues) {
    val c = Desk.colors
    val ctx = LocalContext.current
    var found by remember { mutableStateOf(start) }
    var scanning by remember { mutableStateOf(false) }
    var pasted by remember { mutableStateOf("") }
    var problem by remember { mutableStateOf<String?>(null) }
    val askCamera = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) scanning = true else problem = "Without the camera, paste the link instead."
    }

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(start = 20.dp, end = 20.dp, top = padding.calculateTopPadding() + 12.dp, bottom = padding.calculateBottomPadding() + 24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RoundIconButton(Icons.AutoMirrored.Filled.ArrowBack, "Back", onBack)
            Spacer(Modifier.width(14.dp))
            Text("Link a computer", style = DeskType.title, color = c.ink)
        }

        val p = found
        if (p != null) {
            // The confirmation.
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(c.blue).padding(22.dp)) {
                MoodOrb(Status.Done, size = 64.dp, fill = c.face, stroke = c.faceInk)
                Spacer(Modifier.height(14.dp))
                Text("Link to ${p.name}?", style = DeskType.title, color = c.onCard)
                Spacer(Modifier.height(6.dp))
                Text(
                    "At ${p.hosts.joinToString(" or ")}, port ${p.port}. This phone will see its coding agents and can Allow or Deny their requests.",
                    style = DeskType.body, color = c.onCard.copy(alpha = 0.8f),
                )
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PillButton("Not this one", onClick = { found = null }, filled = false, modifier = Modifier.weight(1f))
                    PillButton("Link", onClick = { onPair(p) }, modifier = Modifier.weight(1f), container = c.cardButton, contentColor = c.onCardButton)
                }
            }
            return@Column
        }

        Text(
            "On your PC, open Desk Companion → Settings → Phone, turn on Link a phone, and tap Show pairing code.",
            style = DeskType.body, color = c.inkSoft,
        )

        if (scanning) {
            Box(Modifier.fillMaxWidth().aspectRatio(1f).clip(RoundedCornerShape(30.dp)).background(c.ink)) {
                QrScanner(
                    onCode = { text ->
                        val parsed = Pairing.parse(text)
                        if (parsed != null) {
                            scanning = false
                            found = parsed
                        } else {
                            problem = "That code isn't a Desk Companion pairing code."
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
            PillButton("Stop scanning", onClick = { scanning = false }, filled = false, modifier = Modifier.fillMaxWidth())
        } else {
            PillButton(
                "Scan the code",
                onClick = {
                    problem = null
                    val granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
                    if (granted) scanning = true else askCamera.launch(Manifest.permission.CAMERA)
                },
                modifier = Modifier.fillMaxWidth(),
                height = 54.dp,
            )
        }

        Text("Or paste the link", style = DeskType.heading, color = c.ink, modifier = Modifier.padding(top = 8.dp))
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(c.surface).padding(16.dp)) {
            if (pasted.isEmpty()) Text("deskcompanion://pair?…", style = DeskType.mono, color = c.inkSoft)
            BasicTextField(
                value = pasted,
                onValueChange = { pasted = it.take(2048) },
                textStyle = DeskType.mono.copy(color = c.ink),
                cursorBrush = SolidColor(c.ink),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        PillButton(
            "Use this link",
            onClick = {
                val parsed = Pairing.parse(pasted)
                if (parsed != null) found = parsed else problem = "That isn't a Desk Companion pairing link."
            },
            filled = false,
            enabled = pasted.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        )
        problem?.let { Text(it, style = DeskType.small, color = androidx.compose.ui.graphics.Color(0xFFD64B3A)) }
    }
}
