package app.deskcompanion.phone

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import app.deskcompanion.phone.link.LinkHub
import app.deskcompanion.phone.update.Updater
import app.deskcompanion.phone.link.Pairing
import app.deskcompanion.phone.link.Unlock
import app.deskcompanion.phone.model.AppState
import app.deskcompanion.phone.model.Look
import app.deskcompanion.phone.model.Settings
import app.deskcompanion.phone.model.Status
import app.deskcompanion.phone.notify.Notifications
import app.deskcompanion.phone.ui.ActivityScreen
import app.deskcompanion.phone.ui.ApprovalSheet
import app.deskcompanion.phone.ui.Desk
import app.deskcompanion.phone.ui.DeskTheme
import app.deskcompanion.phone.ui.HomeScreen
import app.deskcompanion.phone.ui.NavBar
import app.deskcompanion.phone.ui.PairScreen
import app.deskcompanion.phone.ui.QuestionSheet
import app.deskcompanion.phone.ui.SessionScreen
import app.deskcompanion.phone.ui.SettingsScreen
import app.deskcompanion.phone.ui.Tab

class MainActivity : FragmentActivity() {
    /** A pairing link this activity was opened with: shown for confirmation, never acted on by itself. */
    private val incomingPairing = mutableStateOf<Pairing?>(null)
    /** A request whose notification was tapped: only selects which sheet to show. */
    private val incomingReview = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Settings.init(this).let { Look.show(it.character, it.ruiLook, it.ruiTheme, it.dogeshOutfit) }
        Notifications.createChannels(this)
        LinkHub.init(this)
        // If we just arrived from an update, the downloaded file is no longer needed.
        Updater.cleanUp(this)
        read(intent)
        setContent { DeskTheme { App(incomingPairing, incomingReview) } }
    }

    override fun onResume() {
        super.onResume()
        LinkHub.nudge()
        Updater.checkIfDue(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        read(intent)
    }

    private fun read(intent: Intent?) {
        intent ?: return
        intent.data?.toString()?.let { link ->
            val p = Pairing.parse(link)
            if (p != null) incomingPairing.value = p
            else Toast.makeText(this, "That isn't a Desk Companion pairing link", Toast.LENGTH_SHORT).show()
        }
        intent.getStringExtra(Notifications.EXTRA_REVIEW)?.takeIf { it.isNotEmpty() }?.let { incomingReview.value = it }
    }
}

@Composable
private fun App(incomingPairing: MutableState<Pairing?>, incomingReview: MutableState<String?>) {
    val ctx = LocalContext.current
    val c = Desk.colors
    val state = remember { AppState() }
    val link by LinkHub.state.collectAsState()
    val liveSessions by LinkHub.sessions.collectAsState()
    var tab by remember { mutableStateOf(Tab.Home) }
    var openId by remember { mutableStateOf<String?>(null) }
    var reviewId by remember { mutableStateOf<String?>(null) }
    var pairing by remember { mutableStateOf(false) }
    val padding = WindowInsets.systemBars.asPaddingValues()

    // A linked PC's sessions replace the samples.
    LaunchedEffect(link, liveSessions) {
        if (link is LinkHub.State.Unpaired) state.showSamples() else state.showLive(liveSessions)
    }
    LaunchedEffect(Unit) {
        state.onDecide = { rid, allow -> LinkHub.decide(rid, allow) }
        state.onAnswer = { rid, answers -> LinkHub.answer(rid, answers) }
        state.onReply = { rid, text -> LinkHub.reply(rid, text) }
        state.onAway = { LinkHub.setAway(it) }
    }
    // Opened from a pairing link: straight to the confirmation.
    LaunchedEffect(incomingPairing.value) {
        if (incomingPairing.value != null) {
            pairing = true
            openId = null
        }
    }
    // Opened from a request's notification: its sheet, once the session is here.
    val review = incomingReview.value
    LaunchedEffect(review, state.sessions) {
        if (review != null) {
            state.sessions.firstOrNull { it.approval?.rid == review || it.question?.rid == review }?.let {
                reviewId = it.id
                incomingReview.value = null
            }
        }
    }

    val askNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted && !state.live) Notifications.showTestApproval(ctx)
    }
    val testNotification = {
        if (Notifications.canPost(ctx)) Notifications.showTestApproval(ctx)
        else askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    val linkNotifications = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    val notConnected = { Toast.makeText(ctx, "Not connected to your PC right now", Toast.LENGTH_SHORT).show() }
    // Anything that lets an agent act (Allow, an answer, a reply): prove it's you first. Deny never asks.
    val protect = { title: String, action: () -> Unit ->
        if (state.live && state.requireUnlockForAllow) Unlock.ask(ctx as FragmentActivity, title, action) else action()
    }

    BackHandler(enabled = reviewId == null && (pairing || openId != null || tab != Tab.Home)) {
        when {
            pairing -> { pairing = false; incomingPairing.value = null }
            openId != null -> openId = null
            else -> tab = Tab.Home
        }
    }

    Box(Modifier.fillMaxSize().background(c.bg)) {
        val open = openId
        when {
            pairing -> PairScreen(
                start = incomingPairing.value,
                onPair = { p ->
                    LinkHub.pair(ctx, p)
                    pairing = false
                    incomingPairing.value = null
                    tab = Tab.Home
                    // Requests arrive as notifications: ask for them now, when it's clear why.
                    if (!Notifications.canPost(ctx)) linkNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                },
                onBack = { pairing = false; incomingPairing.value = null },
                padding = padding,
            )
            open != null -> SessionScreen(
                state, open,
                onBack = { openId = null },
                onReview = { reviewId = it },
                onReply = { id, text, sent ->
                    protect("Send your reply?") { if (state.reply(id, text)) sent() else notConnected() }
                },
                padding = padding,
            )
            else -> {
                when (tab) {
                    Tab.Home -> HomeScreen(
                        state,
                        onOpen = { openId = it },
                        onReview = { reviewId = it },
                        onBell = { reviewId = state.sessions.firstOrNull { it.status == Status.Waiting && (it.approval != null || it.question != null) }?.id },
                        onLink = { pairing = true },
                        pcName = when (val l = link) {
                            is LinkHub.State.Connected -> l.name
                            is LinkHub.State.Connecting -> l.name
                            is LinkHub.State.Retrying -> l.name
                            else -> null
                        },
                        padding = padding,
                    )
                    Tab.Activity -> ActivityScreen(state, padding)
                    Tab.Settings -> SettingsScreen(
                        state, link,
                        onLink = { pairing = true },
                        onUnlink = { LinkHub.unpair(ctx) },
                        onTestNotification = testNotification,
                        padding = padding,
                    )
                }
                NavBar(
                    selected = tab, onSelect = { tab = it }, badge = state.waitingCount,
                    modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 14.dp),
                )
            }
        }

        // Content scrolls under the status bar; keep the clock readable over it.
        Box(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(c.bg.copy(alpha = 0.94f)))

        val reviewing = reviewId?.let { state.session(it) }
        if (reviewing?.approval != null) {
            ApprovalSheet(
                session = reviewing,
                live = state.live,
                onAllow = {
                    protect("Allow ${reviewing.agent} to ${reviewing.approval.action}?") {
                        if (state.decide(reviewing.id, allow = true)) reviewId = null else notConnected()
                    }
                },
                onDeny = {
                    if (state.decide(reviewing.id, allow = false)) reviewId = null else notConnected()
                },
                onDismiss = { reviewId = null },
            )
        } else if (reviewing?.question != null) {
            QuestionSheet(
                session = reviewing,
                live = state.live,
                onSend = { answers ->
                    protect("Send your answer?") {
                        if (state.answer(reviewing.id, answers)) reviewId = null else notConnected()
                    }
                },
                onDismiss = { reviewId = null },
            )
        } else if (reviewId != null) {
            // Answered elsewhere (on the PC, in the terminal) while the sheet was open.
            LaunchedEffect(reviewId) { reviewId = null }
        }
    }
}
