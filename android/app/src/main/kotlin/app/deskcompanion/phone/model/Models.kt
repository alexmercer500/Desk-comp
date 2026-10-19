package app.deskcompanion.phone.model

/** What an agent session is doing right now. */
enum class Status { Working, Waiting, Done, Error, Idle }

data class Step(val tool: String, val detail: String, val failed: Boolean = false)

/** One file the agent changed in the last task, with its line counts. */
data class FileChange(val path: String, val add: Int, val del: Int)

/** A permission request an agent is holding open until the user decides. */
data class Approval(
    /** The PC's id for this request; a decision names it. Empty in the demo. */
    val rid: String = "",
    val tool: String,
    /** "run", "edit", "open"… */
    val action: String,
    val detail: String,
    val canAlways: Boolean = false,
    /**
     * Allow may be offered: [detail] is all of it. False when it was too long
     * for the phone (then [detail] is only its start, and the PC refuses an
     * Allow for it anyway): Deny, or answer at the PC.
     */
    val allow: Boolean = true,
)

/** One of Claude's multiple-choice questions. */
data class QuestionItem(
    /** Sent back exactly as given: the PC matches the answer to it. */
    val question: String,
    val header: String? = null,
    val multiSelect: Boolean = false,
    val options: List<Choice>,
)

data class Choice(val label: String, val description: String? = null)

/** Claude's question card, waiting for answers. */
data class Question(val rid: String, val items: List<QuestionItem>)

/**
 * What a session is asking where it asked it (Command Code's plan review, a
 * question left to its own card): its choices, shown here, answered at the PC.
 */
data class Ask(
    /** "Plan ready for review"; null for a plain question. */
    val headline: String?,
    val items: List<QuestionItem>,
    /** Where to answer: "Command Code", "your terminal". */
    val where: String,
)

/** A finished turn the PC is holding for a reply from here, until [until] (ms since 1970). */
data class ReplyHold(val rid: String, val until: Long)

data class Session(
    val id: String,
    /** "Claude Code", "Codex"… */
    val agent: String,
    val project: String,
    val status: Status,
    /** One line for what it is doing or did, e.g. "Editing cart.ts". */
    val line: String,
    val prompt: String? = null,
    val summary: String? = null,
    val steps: List<Step> = emptyList(),
    val files: List<FileChange> = emptyList(),
    val minutesAgo: Int = 0,
    val approval: Approval? = null,
    val question: Question? = null,
    /** What it's asking at the PC, when it can't be answered from here. */
    val ask: Ask? = null,
    /** Set while a reply from here continues this session (away mode, PC idle). */
    val reply: ReplyHold? = null,
    /** When the PC last heard from this session (ms since 1970); 0 in the demo. */
    val updatedAt: Long = 0,
)

/** Something the user decided from the phone, for the Activity list. */
data class Decision(val project: String, val what: String, val allowed: Boolean, val minutesAgo: Int)

enum class Filter(val label: String) {
    All("All"), Working("Working"), NeedsYou("Needs you"), Done("Done");

    fun matches(s: Session): Boolean = when (this) {
        All -> true
        Working -> s.status == Status.Working
        NeedsYou -> s.status == Status.Waiting || s.status == Status.Error
        Done -> s.status == Status.Done
    }
}
