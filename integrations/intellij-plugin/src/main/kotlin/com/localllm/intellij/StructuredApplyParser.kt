package com.localllm.intellij

/**
 * Parses machine-oriented file replacement blocks from model output.
 *
 * Format (path relative to project root, forward slashes):
 * ```
 * <<<LOCAL_LLM_FILE path="src/main/kotlin/Foo.kt">>>
 * (full file text)
 * <<<END_LOCAL_LLM_FILE>>>
 * ```
 */
object StructuredApplyParser {

    data class FileBlock(val path: String, val content: String)

    private const val OPEN = "<<<LOCAL_LLM_FILE"
    private const val CLOSE = "<<<END_LOCAL_LLM_FILE>>>"
    private val pathAttr = Regex("""path\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)

    fun parse(text: String): List<FileBlock> {
        val out = mutableListOf<FileBlock>()
        var i = 0
        while (i < text.length) {
            val start = text.indexOf(OPEN, i, ignoreCase = true)
            if (start < 0) break
            val afterOpen = start + OPEN.length
            val headerEnd = text.indexOf(">>>", afterOpen)
            if (headerEnd < 0) {
                i = afterOpen
                continue
            }
            val headerLine = text.substring(start, headerEnd + 3)
            val pathMatch = pathAttr.find(headerLine)
            if (pathMatch == null) {
                i = afterOpen
                continue
            }
            val path = pathMatch.groupValues[1].trim()
            var contentStart = headerEnd + 3
            while (contentStart < text.length && (text[contentStart] == '\n' || text[contentStart] == '\r')) {
                contentStart++
            }
            val end = text.indexOf(CLOSE, contentStart, ignoreCase = true)
            if (end < 0) break
            val rawContent = text.substring(contentStart, end)
            val content = rawContent.trimEnd { ch ->
                ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n'
            }
            if (path.isNotEmpty() && content.isNotEmpty()) {
                out.add(FileBlock(path, content))
            }
            i = end + CLOSE.length
        }
        return out
    }
}
