package com.localllm.intellij

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.ide.util.PropertiesComponent

/**
 * Best-effort persistence of the last agent run for debugging / resume hints (not a full checkpoint).
 */
object AgentSessionStore {

    private const val KEY = "localLlm.agentSession.lastJson"
    private val gson = Gson()

    data class Snapshot(
        val endedAtEpochMs: Long,
        val steps: Int,
        val stopReason: String,
        val summary: String
    )

    fun save(snapshot: Snapshot) {
        val o = JsonObject()
        o.addProperty("endedAtEpochMs", snapshot.endedAtEpochMs)
        o.addProperty("steps", snapshot.steps)
        o.addProperty("stopReason", snapshot.stopReason)
        o.addProperty("summary", snapshot.summary.take(4000))
        PropertiesComponent.getInstance().setValue(KEY, gson.toJson(o))
    }

    fun load(): Snapshot? {
        val raw = PropertiesComponent.getInstance().getValue(KEY) ?: return null
        return try {
            val o = JsonParser.parseString(raw).asJsonObject
            Snapshot(
                endedAtEpochMs = o.get("endedAtEpochMs")?.asLong ?: return null,
                steps = o.get("steps")?.asInt ?: 0,
                stopReason = o.get("stopReason")?.asString ?: "",
                summary = o.get("summary")?.asString ?: ""
            )
        } catch (_: Exception) {
            null
        }
    }
}
