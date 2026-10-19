package app.deskcompanion.phone.link

import app.deskcompanion.phone.model.Approval
import app.deskcompanion.phone.model.Ask
import app.deskcompanion.phone.model.Choice
import app.deskcompanion.phone.model.Question
import app.deskcompanion.phone.model.QuestionItem
import app.deskcompanion.phone.model.ReplyHold
import app.deskcompanion.phone.model.FileChange
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status
import app.deskcompanion.phone.model.Step
import org.json.JSONArray
import org.json.JSONObject

/** The phone link's messages, version 1 (docs/PHONE_LINK.md). One JSON object per line. */
object Protocol {
    const val VERSION = 1

    /** Longest reply the PC accepts. */
    const val MAX_REPLY = 4000

    fun hello(token: String, device: String, away: Boolean) =
        line(JSONObject().put("t", "hello").put("v", VERSION).put("token", token).put("device", device).put("away", away))
    fun seen(rid: String) = line(JSONObject().put("t", "seen").put("rid", rid))
    fun decision(rid: String, allow: Boolean) = line(JSONObject().put("t", "decision").put("rid", rid).put("decision", if (allow) "allow" else "deny"))
    fun answer(rid: String, answers: Map<String, String>): String {
        val o = JSONObject()
        for ((q, a) in answers) o.put(q, a)
        return line(JSONObject().put("t", "answer").put("rid", rid).put("answers", o))
    }
    fun reply(rid: String, text: String) = line(JSONObject().put("t", "reply").put("rid", rid).put("text", text))
    fun character(id: String, look: String?, theme: String?, outfit: String? = null): String {
        val o = JSONObject().put("t", "character").put("id", id)
        if (look != null) o.put("look", look)
        if (theme != null) o.put("theme", theme)
        if (outfit != null) o.put("outfit", outfit)
        return line(o)
    }
    fun away(on: Boolean) = line(JSONObject().put("t", "away").put("on", on))
    /** A picture of this session's window, please (Peek). */
    fun peek(session: String) = line(JSONObject().put("t", "peek").put("session", session))
    fun ping() = line(JSONObject().put("t", "ping"))

    private fun line(o: JSONObject) = o.toString() + "\n"

    /** A message from the PC. */
    sealed interface FromPc {
        /** `hosts`: the PC's addresses right now. `relay`: the relay's address while the PC has it on. */
        data class Welcome(val name: String, val approvals: Boolean, val hosts: List<String> = emptyList(), val relay: String? = null) : FromPc
        data class Error(val code: String, val message: String) : FromPc
        data class Sessions(val sessions: List<Session>) : FromPc
        data class Decided(val rid: String, val ok: Boolean) : FromPc
        /** The character the PC shows (and Rui's look and colour). */
        data class Character(val id: String, val look: String?, val theme: String?, val outfit: String? = null) : FromPc
        /**
         * A piece of a window's picture (base64 JPEG, `part` of `parts`; the
         * first also carries its title and when it was taken), or, with
         * `error`, why there's none.
         */
        data class Peek(
            val session: String,
            val part: Int = 0,
            val parts: Int = 0,
            val data: String = "",
            val title: String = "",
            val at: Long = 0,
            val error: String? = null,
        ) : FromPc
        data object Pong : FromPc
        /** A newer PC's message: ignored. */
        data object Other : FromPc
    }

    /** The message in a line, or null when it isn't valid. */
    fun parse(line: String): FromPc? {
        val o = try {
            JSONObject(line)
        } catch (e: Exception) {
            return null
        }
        return when (o.optString("t")) {
            "welcome" -> FromPc.Welcome(
                o.optString("name", "Your PC"),
                o.optBoolean("approvals", false),
                o.optJSONArray("hosts")?.let { a -> (0 until minOf(a.length(), 8)).map { a.optString(it) }.filter { it.isNotEmpty() } }.orEmpty(),
                Pairing.relayAddress(o.optStringOrNull("relay")),
            )
            "error" -> FromPc.Error(o.optString("code"), o.optString("message"))
            "sessions" -> FromPc.Sessions(sessions(o.optJSONArray("sessions") ?: JSONArray()))
            "decided" -> FromPc.Decided(o.optString("rid"), o.optBoolean("ok", false))
            "character" -> FromPc.Character(o.optString("id"), o.optStringOrNull("look"), o.optStringOrNull("theme"), o.optStringOrNull("outfit"))
            "peek" -> FromPc.Peek(
                session = o.optString("session").ifEmpty { return null },
                part = o.optInt("part", -1),
                parts = o.optInt("parts", 0),
                data = o.optString("data"),
                title = o.optString("title"),
                at = o.optLong("at"),
                error = o.optStringOrNull("error"),
            )
            "pong" -> FromPc.Pong
            "" -> null
            else -> FromPc.Other
        }
    }

    fun sessions(arr: JSONArray): List<Session> = (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let(::session) }

    private fun session(o: JSONObject): Session? {
        val id = o.optString("id").ifEmpty { return null }
        val status = when (o.optString("status")) {
            "working" -> Status.Working
            "waiting" -> Status.Waiting
            "done" -> Status.Done
            "error" -> Status.Error
            else -> Status.Idle
        }
        val steps = o.optJSONArray("steps")?.let { a ->
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { Step(it.optString("tool"), it.optString("detail"), it.optBoolean("failed")) }
        }.orEmpty()
        val files = o.optJSONArray("files")?.let { a ->
            (0 until a.length()).mapNotNull { a.optJSONObject(it) }.map { FileChange(it.optString("path"), it.optInt("add"), it.optInt("del")) }
        }.orEmpty()
        val approval = o.optJSONObject("approval")?.let { a ->
            val rid = a.optString("rid").ifEmpty { return@let null }
            Approval(rid = rid, tool = a.optString("tool"), action = a.optString("action", "continue"), detail = a.optString("detail"), canAlways = a.optBoolean("canAlways"))
        }
        val question = o.optJSONObject("question")?.let { q ->
            val rid = q.optString("rid").ifEmpty { return@let null }
            val items = questionItems(q) ?: return@let null
            Question(rid, items)
        }
        val ask = o.optJSONObject("ask")?.let { a ->
            val items = questionItems(a) ?: return@let null
            Ask(headline = a.optStringOrNull("headline"), items = items, where = a.optString("where").ifEmpty { "your PC" })
        }
        val reply = o.optJSONObject("reply")?.let { r ->
            val rid = r.optString("rid").ifEmpty { return@let null }
            ReplyHold(rid, r.optLong("until"))
        }
        return Session(
            id = id,
            agent = o.optString("agent", "Agent"),
            project = o.optString("project", "Project"),
            status = status,
            line = o.optString("line"),
            prompt = o.optStringOrNull("prompt"),
            summary = o.optStringOrNull("summary"),
            steps = steps,
            files = files,
            approval = approval,
            question = question,
            ask = ask,
            reply = reply,
            updatedAt = o.optLong("updatedAt"),
        )
    }

    /** The `questions` list of a question card, or null when there are none. */
    private fun questionItems(o: JSONObject): List<QuestionItem>? {
        val arr = o.optJSONArray("questions") ?: return null
        val items = (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.mapNotNull { item ->
            val text = item.optString("question").ifEmpty { return@mapNotNull null }
            val opts = item.optJSONArray("options") ?: JSONArray()
            QuestionItem(
                question = text,
                header = item.optStringOrNull("header"),
                multiSelect = item.optBoolean("multiSelect"),
                options = (0 until opts.length()).mapNotNull { opts.optJSONObject(it) }.mapNotNull { c ->
                    Choice(c.optString("label").ifEmpty { return@mapNotNull null }, c.optStringOrNull("description"))
                },
            )
        }
        return items.ifEmpty { null }
    }

    private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key) || !has(key)) null else optString(key).ifEmpty { null }
}
