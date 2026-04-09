package com.localllm.intellij

/**
 * Parses machine-oriented edits from model output: full-file replacement and search/replace patches.
 *
 * Full file:
 * ```
 * <<<LOCAL_LLM_FILE path="src/main/kotlin/Foo.kt">>>
 * (full file text)
 * <<<END_LOCAL_LLM_FILE>>>
 * ```
 *
 * Patch (one or more hunks per file; SEARCH must match exactly once in the file at apply time):
 * ```
 * <<<LOCAL_LLM_PATCH path="src/main/kotlin/Foo.kt">>>
 * <<<< SEARCH
 * exact excerpt from file
 * ====
 * replacement text
 * >>>>
 * <<<END_LOCAL_LLM_PATCH>>>
 * ```
 */
object StructuredApplyParser {

    data class FileBlock(val path: String, val content: String)

    data class Hunk(val search: String, val replace: String)

    sealed interface StructuredEdit {
        val path: String

        data class FullFile(override val path: String, val content: String) : StructuredEdit

        data class Patch(override val path: String, val hunks: List<Hunk>) : StructuredEdit
    }

    private const val OPEN_FILE = "<<<LOCAL_LLM_FILE"
    private const val CLOSE_FILE = "<<<END_LOCAL_LLM_FILE>>>"

    private const val OPEN_PATCH = "<<<LOCAL_LLM_PATCH"
    private const val CLOSE_PATCH = "<<<END_LOCAL_LLM_PATCH>>>"

    private const val MARK_SEARCH = "<<<< SEARCH"
    private const val MARK_SEP = "===="
    private const val MARK_HUNK_END = ">>>>"

    private val pathAttr = Regex("""path\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)

    /** Only full-file blocks (backward compatible). */
    fun parse(text: String): List<FileBlock> =
        parseStructuredEdits(text).filterIsInstance<StructuredEdit.FullFile>().map { FileBlock(it.path, it.content) }

    /** File and patch blocks in document order. */
    fun parseStructuredEdits(text: String): List<StructuredEdit> {
        val out = mutableListOf<StructuredEdit>()
        var i = 0
        while (i < text.length) {
            val nextFile = text.indexOf(OPEN_FILE, i, ignoreCase = true)
            val nextPatch = text.indexOf(OPEN_PATCH, i, ignoreCase = true)
            val takeFile = when {
                nextFile < 0 && nextPatch < 0 -> break
                nextFile < 0 -> false
                nextPatch < 0 -> true
                else -> nextFile <= nextPatch
            }
            if (takeFile) {
                val block = parseFileBlock(text, nextFile) ?: break
                if (block.content.isNotEmpty()) {
                    out.add(StructuredEdit.FullFile(block.path, block.content))
                }
                i = block.nextIndex
            } else {
                val block = parsePatchBlock(text, nextPatch) ?: break
                if (block.hunks.isNotEmpty()) {
                    out.add(StructuredEdit.Patch(block.path, block.hunks))
                }
                i = block.nextIndex
            }
        }
        return out
    }

    private data class ParsedFile(val path: String, val content: String, val nextIndex: Int)

    private fun parseFileBlock(text: String, start: Int): ParsedFile? {
        val afterOpen = start + OPEN_FILE.length
        val headerEnd = text.indexOf(">>>", afterOpen)
        if (headerEnd < 0) return null
        val headerLine = text.substring(start, headerEnd + 3)
        val pathMatch = pathAttr.find(headerLine) ?: return null
        val path = pathMatch.groupValues[1].trim()
        if (path.isEmpty()) return null
        var contentStart = headerEnd + 3
        while (contentStart < text.length && (text[contentStart] == '\n' || text[contentStart] == '\r')) {
            contentStart++
        }
        val end = text.indexOf(CLOSE_FILE, contentStart, ignoreCase = true)
        if (end < 0) return null
        val rawContent = text.substring(contentStart, end)
        val content = rawContent.trimEnd { ch ->
            ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n'
        }
        return ParsedFile(path, content, end + CLOSE_FILE.length)
    }

    private data class ParsedPatch(val path: String, val hunks: List<Hunk>, val nextIndex: Int)

    private fun parsePatchBlock(text: String, start: Int): ParsedPatch? {
        val afterOpen = start + OPEN_PATCH.length
        val headerEnd = text.indexOf(">>>", afterOpen)
        if (headerEnd < 0) return null
        val headerLine = text.substring(start, headerEnd + 3)
        val pathMatch = pathAttr.find(headerLine) ?: return null
        val path = pathMatch.groupValues[1].trim()
        if (path.isEmpty()) return null
        var bodyStart = headerEnd + 3
        while (bodyStart < text.length && (text[bodyStart] == '\n' || text[bodyStart] == '\r')) {
            bodyStart++
        }
        val closeIdx = text.indexOf(CLOSE_PATCH, bodyStart, ignoreCase = true)
        if (closeIdx < 0) return null
        val body = text.substring(bodyStart, closeIdx)
        val hunks = parsePatchHunks(body)
        return ParsedPatch(path, hunks, closeIdx + CLOSE_PATCH.length)
    }

    private fun parsePatchHunks(body: String): List<Hunk> {
        val hunks = mutableListOf<Hunk>()
        var pos = 0
        while (pos < body.length) {
            val hs = body.indexOf(MARK_SEARCH, pos, ignoreCase = false)
            if (hs < 0) break
            var p = hs + MARK_SEARCH.length
            while (p < body.length && (body[p] == '\n' || body[p] == '\r')) p++
            val sep = body.indexOf(MARK_SEP, p)
            if (sep < 0) break
            val searchRaw = body.substring(p, sep)
            var p2 = sep + MARK_SEP.length
            while (p2 < body.length && (body[p2] == '\n' || body[p2] == '\r')) p2++
            val endH = body.indexOf(MARK_HUNK_END, p2)
            if (endH < 0) break
            val replaceRaw = body.substring(p2, endH)
            val search = trimHunkEdge(searchRaw)
            val replace = trimHunkEdge(replaceRaw)
            if (search.isNotEmpty()) {
                hunks.add(Hunk(search, replace))
            }
            pos = endH + MARK_HUNK_END.length
        }
        return hunks
    }

    private fun trimHunkEdge(s: String): String {
        var t = s
        while (t.startsWith("\r\n")) t = t.substring(2)
        while (t.startsWith('\n') || t.startsWith('\r')) t = t.substring(1)
        while (t.endsWith("\r\n")) t = t.substring(0, t.length - 2)
        while (t.isNotEmpty() && (t.last() == '\n' || t.last() == '\r')) t = t.dropLast(1)
        return t
    }
}
