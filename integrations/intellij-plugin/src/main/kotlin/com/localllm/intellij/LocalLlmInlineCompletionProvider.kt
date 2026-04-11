package com.localllm.intellij

import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.runReadAction
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.TextRange
import com.intellij.util.concurrency.annotations.RequiresEdt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.withContext
import java.time.Duration
import kotlin.coroutines.coroutineContext

/**
 * Gray inline suggestions from the local desktop app: plugin → POST /v1/chat → same runtime as the UI → reply as ghost text.
 * Debounced so rapid typing cancels in-flight requests (platform cancels the previous coroutine).
 */
class LocalLlmInlineCompletionProvider : InlineCompletionProvider {

    override val id = InlineCompletionProviderID("com.localllm.intellij.LocalLlmInlineCompletionProvider")

    @RequiresEdt
    override fun isEnabled(event: InlineCompletionEvent): Boolean {
        if (!PropertiesComponent.getInstance().getBoolean(INLINE_ENABLED_KEY, true)) return false
        return when (event) {
            is InlineCompletionEvent.DocumentChange -> true
            is InlineCompletionEvent.DirectCall -> true
            else -> false
        }
    }

    override suspend fun getSuggestion(request: InlineCompletionRequest): InlineCompletionSuggestion {
        delay(DEBOUNCE_MS)
        if (!coroutineContext.isActive) return InlineCompletionSuggestion.Empty

        val props = PropertiesComponent.getInstance()
        val port = props.getValue("localLlm.integrationPort")?.toIntOrNull()?.coerceIn(1024, 65535) ?: 17373
        val token = props.getValue("localLlm.integrationToken") ?: ""

        val health = withContext(Dispatchers.IO) { LocalLlmHttpClient.fetchHealth(port) }
        if (health.runtimeRunning != true) return InlineCompletionSuggestion.Empty

        val editor = request.editor
        if (editor.project == null) return InlineCompletionSuggestion.Empty

        val binary = runReadAction {
            val vf = FileDocumentManager.getInstance().getFile(editor.document)
            vf?.fileType?.isBinary == true
        }
        if (binary) return InlineCompletionSuggestion.Empty

        val caret = request.endOffset
        val doc = request.document
        if (caret < 0 || caret > doc.textLength) return InlineCompletionSuggestion.Empty

        val prefixLen = PREFIX_MAX.coerceAtMost(caret)
        val suffixLen = SUFFIX_MAX.coerceAtMost(doc.textLength - caret)
        val prefixStart = caret - prefixLen
        val prefix = doc.getText(TextRange(prefixStart, caret))
        val suffix = doc.getText(TextRange(caret, caret + suffixLen))

        val path = runReadAction { request.file.virtualFile?.path ?: request.file.name }
        val langName = runReadAction { request.file.language.displayName }

        val system = buildString {
            append("You are an inline code completion engine for IntelliJ IDEA. The user sees your reply as gray ghost text inserted at the cursor.\n")
            append("Output ONLY the raw text to insert — code, identifiers, or comments. No markdown, no ``` fences, no explanations before or after.\n")
            append("Prefer a single logical continuation (one expression, one statement tail, or one line). Stop at a natural boundary.\n")
            append("If nothing sensible fits, output nothing (empty).\n")
            append("Language: ").append(langName).append('\n')
            append("File: ").append(path)
        }
        val user = buildString {
            append("--- before cursor ---\n")
            append(prefix)
            append("\n--- after cursor ---\n")
            append(suffix)
            append("\n---\nComplete only what belongs immediately at the cursor.")
        }

        val messages = listOf(
            LocalLlmHttpClient.ChatMessage("system", system),
            LocalLlmHttpClient.ChatMessage("user", user)
        )

        val reply = try {
            withContext(Dispatchers.IO) {
                LocalLlmHttpClient.chat(
                    port,
                    token,
                    messages,
                    maxTokens = INLINE_MAX_TOKENS,
                    requestTimeout = Duration.ofSeconds(90)
                ).reply
            }
        } catch (_: Exception) {
            return InlineCompletionSuggestion.Empty
        }

        val cleaned = stripCompletionNoise(reply)
        if (cleaned.isBlank() || cleaned.length > MAX_INLINE_CHARS) {
            return InlineCompletionSuggestion.Empty
        }

        return InlineCompletionSingleSuggestion.build {
            emit(InlineCompletionGrayTextElement(cleaned))
        }
    }

    companion object {
        const val INLINE_ENABLED_KEY = "localLlm.inlineCompletionEnabled"

        private const val DEBOUNCE_MS = 420L
        private const val PREFIX_MAX = 6000
        private const val SUFFIX_MAX = 1200
        private const val INLINE_MAX_TOKENS = 160
        private const val MAX_INLINE_CHARS = 8192

        private fun stripCompletionNoise(raw: String): String {
            var t = raw.trim()
            if (t.startsWith("```")) {
                val firstNl = t.indexOf('\n')
                if (firstNl >= 0) t = t.substring(firstNl + 1)
                val close = t.lastIndexOf("```")
                if (close >= 0) t = t.substring(0, close)
            }
            return t.trim()
        }
    }
}
