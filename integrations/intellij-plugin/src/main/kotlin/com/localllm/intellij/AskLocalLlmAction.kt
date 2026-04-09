package com.localllm.intellij

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.ui.Messages
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

class AskLocalLlmAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        val selected = editor?.selectionModel?.selectedText?.trim().orEmpty()
        val question = if (selected.isNotEmpty()) {
            selected
        } else {
            Messages.showInputDialog(project, "Prompt:", "Local LLM", Messages.getQuestionIcon()) ?: return
        }
        if (question.isBlank()) return

        val props = PropertiesComponent.getInstance()
        val port = props.getValue("localLlm.integrationPort")?.toIntOrNull()?.coerceIn(1024, 65535) ?: 17373
        val token = props.getValue("localLlm.integrationToken") ?: ""

        val payload = """{"messages":[{"role":"user","content":${jsonString(question)}}]}"""
        val uri = URI.create("http://127.0.0.1:$port/v1/chat")
        val client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()
        val rb = HttpRequest.newBuilder(uri)
            .timeout(Duration.ofMinutes(15))
            .header("Content-Type", "application/json; charset=utf-8")
        if (token.isNotBlank()) {
            rb.header("Authorization", "Bearer $token")
        }
        val req = rb.POST(HttpRequest.BodyPublishers.ofString(payload)).build()

        try {
            val res = client.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() / 100 != 2) {
                Messages.showErrorDialog(project, res.body(), "Local LLM (${res.statusCode()})")
                return
            }
            val reply = extractReply(res.body()) ?: res.body()
            Messages.showInfoMessage(project, reply, "Local LLM reply")
        } catch (ex: Exception) {
            Messages.showErrorDialog(project, ex.message ?: ex.toString(), "Local LLM error")
        }
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

    /** Minimal JSON unescape for `"reply":"..."` value. */
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

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
