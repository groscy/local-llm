package com.localllm.intellij

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
/**
 * Single-turn JSON contract for [AgentOrchestrator].
 *
 * Examples:
 * - `{"schemaVersion":1,"kind":"tool_calls","calls":[{"name":"read_file","args":{"path":"src/Foo.kt"}}]}`
 * - `{"schemaVersion":1,"kind":"done","summary":"…","finalReply":"…"}`
 */
object AgentJsonProtocol {

    const val SCHEMA_VERSION = 1

    sealed class Parsed {
        data class ToolCalls(val calls: List<ToolCall>) : Parsed()
        data class Done(val summary: String, val finalReply: String) : Parsed()
        data class Invalid(val reason: String) : Parsed()
    }

    data class ToolCall(val name: String, val args: JsonObject)

    fun parseAssistantMessage(raw: String): Parsed {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return Parsed.Invalid("empty reply")
        val root = try {
            JsonParser.parseString(trimmed)
        } catch (e: Exception) {
            return Parsed.Invalid("not valid JSON: ${e.message?.take(200)}")
        }
        if (!root.isJsonObject) return Parsed.Invalid("root must be a JSON object")
        val obj = root.asJsonObject
        val sv = obj.get("schemaVersion")
        if (sv == null || !sv.isJsonPrimitive || sv.asInt != SCHEMA_VERSION) {
            return Parsed.Invalid("schemaVersion must be $SCHEMA_VERSION")
        }
        val kindEl = obj.get("kind") ?: return Parsed.Invalid("missing kind")
        if (!kindEl.isJsonPrimitive) return Parsed.Invalid("kind must be a string")
        val kind = kindEl.asString
        return when (kind) {
            "tool_calls" -> parseToolCalls(obj)
            "done" -> parseDone(obj)
            else -> Parsed.Invalid("unknown kind: $kind")
        }
    }

    private fun parseToolCalls(obj: JsonObject): Parsed {
        val callsEl = obj.get("calls") ?: return Parsed.Invalid("missing calls")
        if (!callsEl.isJsonArray) return Parsed.Invalid("calls must be an array")
        val arr = callsEl.asJsonArray
        if (arr.size() == 0) return Parsed.Invalid("calls is empty")
        val out = ArrayList<ToolCall>(arr.size())
        for (i in 0 until arr.size()) {
            val el = arr[i]
            if (!el.isJsonObject) return Parsed.Invalid("call $i must be an object")
            val c = el.asJsonObject
            val nameEl = c.get("name") ?: return Parsed.Invalid("call $i missing name")
            if (!nameEl.isJsonPrimitive) return Parsed.Invalid("call $i name must be string")
            val name = nameEl.asString.trim()
            if (name.isEmpty()) return Parsed.Invalid("call $i empty name")
            val argsEl = c.get("args")
            val args = if (argsEl == null || argsEl.isJsonNull) {
                JsonObject()
            } else if (argsEl.isJsonObject) {
                argsEl.asJsonObject
            } else {
                return Parsed.Invalid("call $i args must be an object")
            }
            out.add(ToolCall(name, args))
        }
        return Parsed.ToolCalls(out)
    }

    private fun parseDone(obj: JsonObject): Parsed {
        val summary = obj.get("summary")?.takeIf { it.isJsonPrimitive }?.asString?.trim().orEmpty()
        val finalReply = obj.get("finalReply")?.takeIf { it.isJsonPrimitive }?.asString.orEmpty()
        return Parsed.Done(summary, finalReply)
    }

    fun formatToolResultsForUser(step: Int, results: List<Pair<ToolCall, String>>): String {
        return buildString {
            appendLine("Tool results (step $step):")
            for ((call, text) in results) {
                appendLine("--- ${call.name} ${call.args} ---")
                appendLine(text.trimEnd())
                appendLine()
            }
        }.trimEnd()
    }
}
