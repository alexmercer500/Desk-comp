package app.deskcompanion.phone.link

import app.deskcompanion.phone.model.Approval
import app.deskcompanion.phone.model.FileChange
import app.deskcompanion.phone.model.Session
import app.deskcompanion.phone.model.Status
import app.deskcompanion.phone.model.Step
import org.json.JSONArray
import org.json.JSONObject

/** The phone link's messages, version 1 (docs/PHONE_LINK.md). One JSON object per line. */
object Protocol {
    const val VERSION = 1

    fun hello(token: String, device: String) = line(JSONObject().put("t", "hello").put("v", VERSION).put("token", token).put("device", device))
    fun seen(rid: String) = line(JSONObject().put("t", "seen").put("rid", rid))
    fun decision(rid: String, allow: Boolean) = line(JSONObject().put("t", "decision").put("rid", rid).put("decision", if (allow) "allow" else "deny"))
    fun ping() = line(JSONObject().put("t", "ping"))

    private fun line(o: JSONObject) = o.toString() + "\n"

    /** A message from the PC. */
    sealed interface FromPc {
        data class Welcome(val name: String, val approvals: Boolean) : FromPc
        data class Error(val code: String, val message: String) : FromPc
        data class Sessions(val sessions: List<Session>) : FromPc
        data class Decided(val rid: String, val ok: Boolean) : FromPc
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
            "welcome" -> FromPc.Welcome(o.optString("name", "Your PC"), o.optBoolean("approvals", false))
            "error" -> FromPc.Error(o.optString("code"), o.optString("message"))
            "sessions" -> FromPc.Sessions(sessions(o.optJSONArray("sessions") ?: JSONArray()))
            "decided" -> FromPc.Decided(o.optString("rid"), o.optBoolean("ok", false))
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
            updatedAt = o.optLong("updatedAt"),
        )
    }

    private fun JSONObject.optStringOrNull(key: String): String? = if (isNull(key) || !has(key)) null else optString(key).ifEmpty { null }
}
