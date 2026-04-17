package com.localllm.intellij

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AgentJsonProtocolTest {

    @Test
    fun parseToolCalls() {
        val raw =
            """{"schemaVersion":1,"kind":"tool_calls","calls":[{"name":"read_file","args":{"path":"src/A.kt"}}]}"""
        val p = AgentJsonProtocol.parseAssistantMessage(raw)
        assertTrue(p is AgentJsonProtocol.Parsed.ToolCalls)
        val tc = p as AgentJsonProtocol.Parsed.ToolCalls
        assertEquals(1, tc.calls.size)
        assertEquals("read_file", tc.calls[0].name)
        assertEquals("src/A.kt", tc.calls[0].args.get("path").asString)
    }

    @Test
    fun parseDone() {
        val raw = """{"schemaVersion":1,"kind":"done","summary":"ok","finalReply":"hello"}"""
        val p = AgentJsonProtocol.parseAssistantMessage(raw)
        assertTrue(p is AgentJsonProtocol.Parsed.Done)
        val d = p as AgentJsonProtocol.Parsed.Done
        assertEquals("ok", d.summary)
        assertEquals("hello", d.finalReply)
    }

    @Test
    fun formatToolResults() {
        val calls = listOf(
            AgentJsonProtocol.ToolCall("read_file", com.google.gson.JsonParser.parseString("""{"path":"x"}""").asJsonObject)
        )
        val results = listOf(calls[0] to "line1\nline2")
        val s = AgentJsonProtocol.formatToolResultsForUser(2, results)
        assertTrue(s.contains("read_file"))
        assertTrue(s.contains("line1"))
    }
}
