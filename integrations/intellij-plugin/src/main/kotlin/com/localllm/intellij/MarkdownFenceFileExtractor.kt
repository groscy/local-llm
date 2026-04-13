package com.localllm.intellij

/**
 * When the model uses normal markdown fences instead of [StructuredApplyParser] blocks, we still
 * apply **full-file** writes if a block clearly names a project-relative path (comment header or
 * fence info line). Avoids treating anonymous ```kotlin snippets as files.
 */
object MarkdownFenceFileExtractor {

    private val fileLineSlash = Regex("""^\s*//\s*(?:File|Path)\s*:\s*(.+?)\s*$""", RegexOption.IGNORE_CASE)
    private val hashFileLine = Regex("""^\s*#\s*(?:File|Path|file)\s*:\s*(.+?)\s*$""", RegexOption.IGNORE_CASE)
    private val htmlCommentFile =
        Regex("""^\s*<!--\s*(?:file|path)\s*:\s*(.+?)\s*-->\s*$""", RegexOption.IGNORE_CASE)

    private val extPattern =
        Regex(
            """\.(kt|kts|java|gradle|xml|json|tsx?|jsx?|css|scss|html?|properties|ya?ml|md|sql|py|rs|go|cs|c|h|cpp|hpp|swift|rb|php|toml)$""",
            RegexOption.IGNORE_CASE
        )

    private const val minContentChars = 8

    fun parseFencedFullFiles(markdown: String): List<StructuredApplyParser.StructuredEdit.FullFile> {
        val raw = mutableListOf<StructuredApplyParser.StructuredEdit.FullFile>()
        var i = 0
        while (i < markdown.length) {
            val tick = markdown.indexOf("```", i)
            if (tick < 0) break
            val lineEnd = markdown.indexOf('\n', tick + 3)
            if (lineEnd < 0) break
            val info = markdown.substring(tick + 3, lineEnd).trim()
            val bodyStart = lineEnd + 1
            val endTick = markdown.indexOf("```", bodyStart)
            if (endTick < 0) break
            val body = markdown.substring(bodyStart, endTick)
            resolvePathAndContent(info, body)?.let { (path, content) ->
                if (content.length >= minContentChars) {
                    raw.add(StructuredApplyParser.StructuredEdit.FullFile(path, content))
                }
            }
            i = endTick + 3
        }
        return dedupeLastWins(raw)
    }

    private fun dedupeLastWins(
        edits: List<StructuredApplyParser.StructuredEdit.FullFile>
    ): List<StructuredApplyParser.StructuredEdit.FullFile> {
        val byPath = LinkedHashMap<String, StructuredApplyParser.StructuredEdit.FullFile>()
        for (e in edits) {
            val key = e.path.replace('\\', '/')
            byPath[key] = e
        }
        return byPath.values.toList()
    }

    private fun resolvePathAndContent(info: String, bodyRaw: String): Pair<String, String>? {
        val bodyNorm = bodyRaw.trimEnd(' ', '\t', '\r', '\n')
        if (bodyNorm.isEmpty()) return null

        val newlineIdx = bodyNorm.indexOf('\n')
        val firstLine = if (newlineIdx < 0) bodyNorm else bodyNorm.substring(0, newlineIdx)
        val afterFirst =
            if (newlineIdx < 0) "" else bodyNorm.substring(newlineIdx + 1).trimStart('\r', '\n')

        matchFileComment(firstLine.trim())?.let { p ->
            val norm = normalizePath(p)
            if (!isSafeRelativePath(norm)) return@let
            if (afterFirst.length < minContentChars) return@let
            return Pair(norm, afterFirst)
        }

        pathFromInfoTokens(info)?.let { p ->
            val norm = normalizePath(p)
            if (!isSafeRelativePath(norm)) return@let
            if (bodyNorm.length < minContentChars) return@let
            return Pair(norm, bodyNorm)
        }

        val bareNorm = normalizePath(firstLine.trim())
        if (isSafeRelativePath(bareNorm) && bareNorm.contains('/') && extPattern.containsMatchIn(bareNorm)) {
            if (afterFirst.length < minContentChars) return null
            return Pair(bareNorm, afterFirst)
        }

        return null
    }

    private fun matchFileComment(line: String): String? {
        val t = line.trim()
        for (rx in listOf(fileLineSlash, hashFileLine, htmlCommentFile)) {
            val m = rx.find(t) ?: continue
            if (m.range.first != 0 || m.range.last != t.lastIndex) continue
            m.groupValues[1].trim().takeIf { it.isNotEmpty() }?.let { return it }
        }
        return null
    }

    private fun pathFromInfoTokens(info: String): String? {
        if (info.isBlank()) return null
        for (part in info.split(Regex("\\s+"))) {
            val p = part.trim()
            if (p.contains('/') && extPattern.containsMatchIn(p) && isSafeRelativePath(normalizePath(p))) {
                return p
            }
        }
        return null
    }

    private fun normalizePath(p: String): String = p.trim().replace('\\', '/').trimStart('/')

    private fun isSafeRelativePath(normalized: String): Boolean {
        if (normalized.isEmpty()) return false
        if (normalized.contains("..")) return false
        if (normalized.startsWith("/")) return false
        if (Regex("""^[A-Za-z]:[/\\]""").containsMatchIn(normalized)) return false
        return true
    }
}
