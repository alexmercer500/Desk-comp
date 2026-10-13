package app.deskcompanion.phone.model

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

/**
 * Everything the screens show. Until a PC is linked it holds sample sessions so
 * the app can be tried; once linked, [showLive] replaces them with the PC's,
 * and [decide] goes over the link ([onDecide]).
 */
class AppState(initial: List<Session> = DemoData.sessions(), private val store: Settings = Settings.shared) {
    var sessions by mutableStateOf(initial)
        private set
    var decisions by mutableStateOf(emptyList<Decision>())
        private set
    var filter by mutableStateOf(Filter.All)
    /** Showing a linked PC's sessions (not the samples). */
    var live by mutableStateOf(false)
        private set
    /** Sends a decision to the PC; false when it couldn't (not connected). */
    var onDecide: ((rid: String, allow: Boolean) -> Boolean)? = null
    /** Sends answers to a question card; false when it couldn't. */
    var onAnswer: ((rid: String, answers: Map<String, String>) -> Boolean)? = null
    /** Sends a reply to a held turn; false when it couldn't. */
    var onReply: ((rid: String, text: String) -> Boolean)? = null
    /** Away mode switched (the PC is told). */
    var onAway: ((Boolean) -> Unit)? = null

    fun showLive(list: List<Session>) {
        live = true
        sessions = list
    }

    fun showSamples() {
        if (!live) return
        live = false
        sessions = DemoData.sessions()
    }

    // Settings: kept on the phone (see Settings), mirrored here so the screens redraw.
    var notifyDone by mutableStateOf(store.notifyDone)
        private set
    var notifyNeedsYou by mutableStateOf(store.notifyNeedsYou)
        private set
    var notifyErrors by mutableStateOf(store.notifyErrors)
        private set
    var quietHours by mutableStateOf(store.quietHours)
        private set
    var requireUnlockForAllow by mutableStateOf(store.requireUnlockForAllow)
        private set
    /** While away, a finished task waits a few minutes for a reply from here. */
    var awayMode by mutableStateOf(store.awayMode)
        private set

    fun changeNotifyDone(v: Boolean) { notifyDone = v; store.notifyDone = v }
    fun changeNotifyNeedsYou(v: Boolean) { notifyNeedsYou = v; store.notifyNeedsYou = v }
    fun changeNotifyErrors(v: Boolean) { notifyErrors = v; store.notifyErrors = v }
    fun changeQuietHours(v: Boolean) { quietHours = v; store.quietHours = v }
    fun changeRequireUnlockForAllow(v: Boolean) { requireUnlockForAllow = v; store.requireUnlockForAllow = v }
    fun changeAwayMode(v: Boolean) { awayMode = v; store.awayMode = v; onAway?.invoke(v) }

    fun session(id: String): Session? = sessions.firstOrNull { it.id == id }

    val visible: List<Session>
        get() = sessions.filter { filter.matches(it) }.sortedWith(order)

    /** What most needs the user, for the big card on Home. */
    val hero: Session?
        get() = sessions.minWithOrNull(order)

    /** What needs you first, then the most recent. */
    private val order = compareBy<Session>({ rank(it.status) }, { it.minutesAgo }, { -it.updatedAt })

    val waitingCount: Int get() = sessions.count { it.status == Status.Waiting }
    val doneToday: Int get() = sessions.count { it.status == Status.Done }
    val totalToday: Int get() = sessions.size

    /** Allow or Deny the request a session is holding open. */
    /** False when it couldn't be sent (the link is down); the request stays. */
    fun decide(sessionId: String, allow: Boolean): Boolean {
        val s = session(sessionId) ?: return false
        val request = s.approval ?: return false // already answered (here or in the terminal)
        if (live && onDecide?.invoke(request.rid, allow) != true) return false
        replace(
            s.copy(
                approval = null,
                status = if (allow) Status.Working else Status.Idle,
                line = if (allow) "Carrying on" else "Denied. Waiting for the agent",
            ),
        )
        decisions = listOf(Decision(s.project, "${request.action} ${request.detail}", allow, 0)) + decisions
        return true
    }

    /** Answers to the question card a session is showing: question → choice(s) or typed text. */
    fun answer(sessionId: String, answers: Map<String, String>): Boolean {
        val s = session(sessionId) ?: return false
        val q = s.question ?: return false
        if (answers.isEmpty() || answers.values.any { it.isBlank() }) return false
        if (live && onAnswer?.invoke(q.rid, answers) != true) return false
        replace(s.copy(question = null, status = Status.Working, line = "Carrying on with your answer"))
        decisions = listOf(Decision(s.project, "Answered: ${answers.values.joinToString(", ").take(80)}", true, 0)) + decisions
        return true
    }

    /** Whether a reply from here would reach the agent right now. */
    fun canReply(s: Session): Boolean = if (live) s.reply != null else s.status == Status.Done

    /** A further prompt for a finished session; the agent carries on with it. */
    fun reply(sessionId: String, text: String): Boolean {
        val s = session(sessionId) ?: return false
        val prompt = text.trim()
        if (prompt.isEmpty() || !canReply(s)) return false
        if (live && onReply?.invoke(s.reply!!.rid, prompt) != true) return false
        replace(
            s.copy(
                status = Status.Working,
                line = "Working on your reply",
                prompt = prompt,
                summary = null,
                steps = listOf(Step("You", prompt)),
                files = emptyList(),
                minutesAgo = 0,
                reply = null,
            ),
        )
        return true
    }

    private fun replace(updated: Session) {
        sessions = sessions.map { if (it.id == updated.id) updated else it }
    }

    private fun rank(s: Status) = when (s) {
        Status.Waiting -> 0
        Status.Error -> 1
        Status.Working -> 2
        Status.Done -> 3
        Status.Idle -> 4
    }
}

object DemoData {
    fun sessions(): List<Session> = listOf(
        Session(
            id = "s1", agent = "Claude Code", project = "shop-app", status = Status.Waiting,
            line = "Wants to run a command", minutesAgo = 1,
            prompt = "Fix the rounding in the cart total",
            approval = Approval(tool = "Bash", action = "run", detail = "npm test -- --coverage", canAlways = true),
            steps = listOf(
                Step("Read", "src/cart.ts"),
                Step("Edit", "src/cart.ts"),
                Step("Bash", "npm test -- --coverage"),
            ),
        ),
        Session(
            id = "s5", agent = "Claude Code", project = "mobile-app", status = Status.Waiting,
            line = "Has a question for you", minutesAgo = 2,
            prompt = "Add dark mode",
            question = Question(
                rid = "",
                items = listOf(
                    QuestionItem(
                        question = "Which way should dark mode follow?",
                        header = "Theme",
                        options = listOf(
                            Choice("The phone's setting", "Switches with the system"),
                            Choice("A switch in the app", "The user picks, saved per device"),
                        ),
                    ),
                ),
            ),
            steps = listOf(Step("Read", "src/theme.ts"), Step("AskUserQuestion", "Which way should dark mode follow?")),
        ),
        Session(
            id = "s2", agent = "Codex", project = "blog", status = Status.Working,
            line = "Editing posts/index.tsx", minutesAgo = 3,
            prompt = "Add a reading time to each post",
            steps = listOf(Step("Read", "posts/index.tsx"), Step("Edit", "posts/index.tsx")),
        ),
        Session(
            id = "s3", agent = "Claude Code", project = "api-gateway", status = Status.Done,
            line = "Added rate limiting to /v1/orders", minutesAgo = 12,
            prompt = "Add rate limiting to the orders endpoint",
            summary = "Added a token-bucket limiter (60 requests a minute per key) to /v1/orders and a test for the 429 case. All 48 tests pass.",
            files = listOf(FileChange("src/limiter.ts", 64, 0), FileChange("src/routes/orders.ts", 9, 2), FileChange("test/orders.test.ts", 31, 4)),
            steps = listOf(
                Step("Read", "src/routes/orders.ts"),
                Step("Write", "src/limiter.ts"),
                Step("Edit", "src/routes/orders.ts"),
                Step("Bash", "npm test"),
            ),
        ),
        Session(
            id = "s4", agent = "Gemini CLI", project = "docs-site", status = Status.Error,
            line = "Stopped with an error", minutesAgo = 25,
            prompt = "Migrate the docs to the new theme",
            summary = "The build failed: Cannot find module 'theme-next'.",
            steps = listOf(Step("Edit", "docusaurus.config.js"), Step("Bash", "npm run build", failed = true)),
        ),
    )
}
