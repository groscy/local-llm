package com.localllm.intellij

/**
 * HTTP client for the Local LLM Desktop **localhost-only** integration bridge.
 *
 * Contract (must stay aligned with [src/main/services/integrationServer.ts] in the desktop app):
 * - [fetchHealth]: `GET /health` — no auth; reachability + `runtimeRunning` / `runtimeKind` snapshot.
 * - [chat]: `POST /v1/chat` — optional `Authorization: Bearer <token>` when the app has a token set.
 * - [postPluginReport]: `POST /v1/plugin/report` — same auth as chat; `kind` must match the desktop Zod enum (see [PluginReportKind]).
 * - [fetchRuntimeStatus]: `GET /v1/runtime/status` — same auth as chat; optional richer model info for the IDE UI.
 *
 * **Future bridge (RFC):** agent mode today loops `POST /v1/chat` from the IDE. Optional upgrades without breaking
 * existing clients: (1) SSE or chunked streaming for token-by-token UI; (2) optional `tools` array + tool-call
 * messages in the JSON body, forwarded to llama.cpp/Ollama native APIs; (3) dedicated `POST /v1/agent/stream` for
 * server-side loops (usually inferior to IDE-side tools for PSI/editor access). Coordinate schema changes with
 * [src/main/services/integrationServer.ts] `chatBodySchema` and desktop runtime adapters.
 */
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

/**
 * POST /v1/chat with { "messages": [ { "role", "content" }, ... ] }.
 * GET /health is unauthenticated (bridge reachability + runtime snapshot).
 */
object LocalLlmHttpClient {

    data class ChatMessage(val role: String, val content: String)

    /** Result of POST /v1/chat (desktop integration server). */
    data class ChatCompletion(
        val reply: String,
        val promptTokens: Int? = null,
        val completionTokens: Int? = null
    )

    /** Result of GET /v1/runtime/status (authenticated like /v1/chat). */
    data class RuntimeStatus(
        val httpStatus: Int,
        val running: Boolean?,
        val kind: String?,
        val modelPath: String?,
        val endpoint: String?,
        val errorHint: String?
    )

    /** Result of GET /health on the desktop app integration server. */
    data class BridgeHealth(
        /** TCP connect succeeded and an HTTP response was received. */
        val reachable: Boolean,
        val httpStatus: Int,
        /** From JSON when HTTP 200. */
        val runtimeRunning: Boolean?,
        val runtimeKind: String?,
        /** Error summary when unreachable or unexpected response. */
        val errorHint: String?
    )

    fun fetchHealth(port: Int): BridgeHealth {
        val uri = URI.create("http://127.0.0.1:$port/health")
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()
        val req = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(4)).GET().build()
        return try {
            val res = client.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() == 200) {
                parseHealthJson(res.body())
            } else {
                BridgeHealth(
                    reachable = true,
                    httpStatus = res.statusCode(),
                    runtimeRunning = null,
                    runtimeKind = null,
                    errorHint = res.body().trim().take(240).ifBlank { "HTTP ${res.statusCode()}" }
                )
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            unreachableHealth(port, e)
        } catch (e: Exception) {
            unreachableHealth(port, e)
        }
    }

    private fun unreachableHealth(port: Int, e: Throwable): BridgeHealth {
        val hint = buildString {
            append(e.javaClass.simpleName)
            val m = e.message?.trim()
            if (!m.isNullOrEmpty()) {
                append(": ")
                append(m.take(200))
            }
        }
        return BridgeHealth(
            reachable = false,
            httpStatus = 0,
            runtimeRunning = null,
            runtimeKind = null,
            errorHint = hint.ifBlank { "Cannot reach 127.0.0.1:$port" }
        )
    }

    fun fetchRuntimeStatus(port: Int, token: String): RuntimeStatus {
        val uri = URI.create("http://127.0.0.1:$port/v1/runtime/status")
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()
        val rb = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5)).GET()
        if (token.isNotBlank()) {
            rb.header("Authorization", "Bearer $token")
        }
        val req = rb.build()
        return try {
            val res = client.send(req, HttpResponse.BodyHandlers.ofString())
            val body = res.body()
            if (res.statusCode() == 200) {
                RuntimeStatus(
                    httpStatus = 200,
                    running = Regex(""""running"\s*:\s*(true|false)""").find(body)?.groupValues?.get(1) == "true",
                    kind = Regex(""""kind"\s*:\s*"([^"]*)"""").find(body)?.groupValues?.getOrNull(1)?.ifBlank { null },
                    modelPath = extractJsonStringField(body, "modelPath"),
                    endpoint = extractJsonStringField(body, "endpoint"),
                    errorHint = null
                )
            } else {
                RuntimeStatus(
                    httpStatus = res.statusCode(),
                    running = null,
                    kind = null,
                    modelPath = null,
                    endpoint = null,
                    errorHint = body.trim().take(240).ifBlank { "HTTP ${res.statusCode()}" }
                )
            }
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            RuntimeStatus(0, null, null, null, null, e.message?.take(200))
        } catch (e: Exception) {
            RuntimeStatus(0, null, null, null, null, e.message?.take(200))
        }
    }

    private fun extractJsonStringField(json: String, field: String): String? {
        val m = Regex(""""$field"\s*:\s*"((?:[^"\\]|\\.)*)"""").find(json) ?: return null
        return unescapeJsonString(m.groupValues[1]).ifBlank { null }
    }

    private fun unescapeJsonString(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            if (s[i] == '\\' && i + 1 < s.length) {
                when (s[i + 1]) {
                    'n' -> {
                        out.append('\n')
                        i += 2
                    }
                    'r' -> {
                        out.append('\r')
                        i += 2
                    }
                    't' -> {
                        out.append('\t')
                        i += 2
                    }
                    '"' -> {
                        out.append('"')
                        i += 2
                    }
                    '\\' -> {
                        out.append('\\')
                        i += 2
                    }
                    'u' -> {
                        if (i + 6 <= s.length) {
                            out.append(s.substring(i + 2, i + 6).toInt(16).toChar())
                            i += 6
                        } else {
                            i++
                        }
                    }
                    else -> {
                        out.append(s[i + 1])
                        i += 2
                    }
                }
            } else {
                out.append(s[i])
                i++
            }
        }
        return out.toString()
    }

    private fun parseHealthJson(json: String): BridgeHealth {
        val running = Regex(""""runtimeRunning"\s*:\s*(true|false)""").find(json)?.groupValues?.get(1) == "true"
        val kind = Regex(""""runtimeKind"\s*:\s*"([^"]*)"""").find(json)?.groupValues?.getOrNull(1)?.ifBlank { null }
        return BridgeHealth(
            reachable = true,
            httpStatus = 200,
            runtimeRunning = running,
            runtimeKind = kind,
            errorHint = null
        )
    }

    /**
     * True for refused connection, timeouts, and similar failures from [java.net.http.HttpClient].
     */
    fun isConnectFailure(t: Throwable): Boolean {
        var c: Throwable? = t
        while (c != null) {
            when (c) {
                is ConnectException -> return true
                is SocketTimeoutException -> return true
                is java.net.http.HttpTimeoutException -> return true
                is IOException -> {
                    val m = c.message?.lowercase() ?: ""
                    if ("connection refused" in m || "failed to connect" in m || "timed out" in m) return true
                }
            }
            c = c.cause
        }
        val m = t.message?.lowercase() ?: ""
        return "connection refused" in m || "connectexception" in m
    }

    /**
     * POST /v1/plugin/report — fire-and-forget activity from the IDE to the desktop app (same auth as /v1/chat).
     */
    fun postPluginReport(
        port: Int,
        token: String,
        source: String,
        kind: String,
        message: String?,
        meta: Map<String, Any?> = emptyMap()
    ) {
        val body = buildPluginReportJson(source, kind, message, meta)
        val uri = URI.create("http://127.0.0.1:$port/v1/plugin/report")
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build()
        val rb = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofSeconds(6))
            .header("Content-Type", "application/json; charset=utf-8")
        if (token.isNotBlank()) {
            rb.header("Authorization", "Bearer $token")
        }
        val req = rb.POST(HttpRequest.BodyPublishers.ofString(body)).build()
        try {
            client.send(req, HttpResponse.BodyHandlers.discarding())
        } catch (_: Exception) {
            // Best-effort: desktop may be off or integration disabled
        }
    }

    private fun jsonMetaValue(v: Any?): String = when (v) {
        null -> "null"
        is Number -> v.toString()
        is Boolean -> if (v) "true" else "false"
        else -> jsonString(v.toString())
    }

    private fun buildMetaJson(meta: Map<String, Any?>): String {
        if (meta.isEmpty()) return "{}"
        return meta.entries.joinToString(",", "{", "}") { (k, v) ->
            "${jsonString(k)}:${jsonMetaValue(v)}"
        }
    }

    private fun buildPluginReportJson(source: String, kind: String, message: String?, meta: Map<String, Any?>): String {
        return buildString {
            append("{\"source\":").append(jsonString(source))
            append(",\"kind\":").append(jsonString(kind))
            if (!message.isNullOrBlank()) {
                append(",\"message\":").append(jsonString(message))
            }
            if (meta.isNotEmpty()) {
                append(",\"meta\":").append(buildMetaJson(meta))
            }
            append('}')
        }
    }

    class LocalLlmHttpException(val status: Int, val body: String) :
        Exception("HTTP $status: ${body.take(500)}")

    fun chat(port: Int, token: String, messages: List<ChatMessage>): ChatCompletion =
        chat(port, token, messages, maxTokens = null, requestTimeout = Duration.ofMinutes(15))

    /**
     * @param maxTokens when set, sent as `maxTokens` in the JSON body so the desktop app can cap completion length
     * (e.g. inline IDE suggestions) without changing global chat settings.
     * @param requestTimeout HTTP client timeout for the whole request (inline completion uses a shorter value).
     */
    fun chat(
        port: Int,
        token: String,
        messages: List<ChatMessage>,
        maxTokens: Int?,
        requestTimeout: Duration
    ): ChatCompletion {
        val body = buildMessagesJson(messages, maxTokens)
        val uri = URI.create("http://127.0.0.1:$port/v1/chat")
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()
        val rb = HttpRequest.newBuilder(uri)
            .timeout(requestTimeout)
            .header("Content-Type", "application/json; charset=utf-8")
        if (token.isNotBlank()) {
            rb.header("Authorization", "Bearer $token")
        }
        val req = rb.POST(HttpRequest.BodyPublishers.ofString(body)).build()
        return try {
            val res = client.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() / 100 != 2) {
                throw LocalLlmHttpException(res.statusCode(), res.body())
            }
            val raw = res.body()
            ChatCompletion(
                reply = extractReply(raw) ?: raw,
                promptTokens = extractJsonIntField(raw, "promptTokens"),
                completionTokens = extractJsonIntField(raw, "completionTokens")
            )
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            throw e
        }
    }

    private fun buildMessagesJson(messages: List<ChatMessage>, maxTokens: Int? = null): String {
        val parts = messages.joinToString(",") { m ->
            """{"role":${jsonString(m.role)},"content":${jsonString(m.content)}}"""
        }
        val maxPart = if (maxTokens != null) ""","maxTokens":${maxTokens.coerceIn(1, 262_144)}""" else ""
        return """{"messages":[$parts]$maxPart}"""
    }

    private fun jsonString(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) {
            when (c) {
                '\\' -> sb.append("\\\\")
                '"' -> sb.append("\\\"")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c.code < 32) {
                    sb.append(String.format("\\u%04x", c.code))
                } else {
                    sb.append(c)
                }
            }
        }
        sb.append('"')
        return sb.toString()
    }

    private fun extractJsonIntField(json: String, field: String): Int? {
        val m = Regex(""""$field"\s*:\s*(\d+)\b""").find(json) ?: return null
        return m.groupValues[1].toIntOrNull()
    }

    private fun extractReply(json: String): String? {
        val key = "\"reply\""
        val i = json.indexOf(key)
        if (i < 0) return null
        val colon = json.indexOf(':', i)
        if (colon < 0) return null
        var j = colon + 1
        while (j < json.length && json[j].isWhitespace()) j++
        if (j >= json.length || json[j] != '"') return null
        j++
        val out = StringBuilder()
        while (j < json.length) {
            val c = json[j++]
            if (c == '"') return out.toString()
            if (c == '\\' && j < json.length) {
                when (val esc = json[j++]) {
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    '"' -> out.append('"')
                    '\\' -> out.append('\\')
                    'u' -> {
                        if (j + 4 <= json.length) {
                            val hex = json.substring(j, j + 4)
                            out.append(hex.toInt(16).toChar())
                            j += 4
                        }
                    }
                    else -> out.append(esc)
                }
            } else {
                out.append(c)
            }
        }
        return null
    }
}
