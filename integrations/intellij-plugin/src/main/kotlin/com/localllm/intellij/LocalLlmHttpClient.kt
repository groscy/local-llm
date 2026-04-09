package com.localllm.intellij

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

    fun chat(port: Int, token: String, messages: List<ChatMessage>): ChatCompletion {
        val body = buildMessagesJson(messages)
        val uri = URI.create("http://127.0.0.1:$port/v1/chat")
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()
        val rb = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofMinutes(15))
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

    class LocalLlmHttpException(val status: Int, val body: String) :
        Exception("HTTP $status: ${body.take(500)}")

    private fun buildMessagesJson(messages: List<ChatMessage>): String {
        val parts = messages.joinToString(",") { m ->
            """{"role":${jsonString(m.role)},"content":${jsonString(m.content)}}"""
        }
        return """{"messages":[$parts]}"""
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
