package com.localllm.intellij

/**
 * Model protocol: if the model needs more information, it must start the reply with a line
 * containing only `[CLARIFY]` (case-insensitive), then one question per line (numbered `1.` or bullet `-`).
 */
object ClarifyResponseParser {

    private val clarifyMarker = Regex("""^\s*\[CLARIFY]\s*$""", RegexOption.IGNORE_CASE)

    sealed interface Parsed {
        data class DirectAnswer(val text: String) : Parsed
        data class NeedsClarification(val questions: List<String>, val rawModelReply: String) : Parsed
    }

    fun parse(rawReply: String): Parsed {
        val lines = rawReply.lines()
        val firstNonEmpty = lines.indexOfFirst { it.isNotBlank() }
        if (firstNonEmpty < 0) return Parsed.DirectAnswer(rawReply.trim())

        val firstLine = lines[firstNonEmpty].trim()
        if (!clarifyMarker.matches(firstLine)) {
            return Parsed.DirectAnswer(rawReply.trim())
        }

        val questions = mutableListOf<String>()
        for (i in (firstNonEmpty + 1) until lines.size) {
            val line = lines[i].trim()
            if (line.isEmpty()) continue
            val q = when {
                line.matches(Regex("""^\d+\.\s*.+""")) -> line.replaceFirst(Regex("""^\d+\.\s*"""), "").trim()
                line.startsWith("-") -> line.removePrefix("-").trim()
                line.startsWith("•") -> line.removePrefix("•").trim()
                else -> line
            }
            if (q.isNotEmpty()) questions.add(q)
        }

        return if (questions.isEmpty()) {
            Parsed.DirectAnswer(rawReply.trim())
        } else {
            Parsed.NeedsClarification(questions, rawReply.trim())
        }
    }

    /** Text shown in the tool window when the model asks for clarification (without raw protocol noise). */
    fun userFacingClarifyText(questions: List<String>): String =
        buildString {
            appendLine("The model needs a bit more context:")
            questions.forEachIndexed { idx, q -> appendLine("${idx + 1}. $q") }
        }
}
