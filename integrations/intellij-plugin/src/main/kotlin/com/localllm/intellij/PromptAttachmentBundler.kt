package com.localllm.intellij

import com.intellij.openapi.fileTypes.FileTypeManager
import com.intellij.openapi.fileTypes.UnknownFileType
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import java.nio.charset.StandardCharsets
import java.nio.file.Paths

/**
 * Reads selected [VirtualFile]s into a single user-message appendix (path + fenced content).
 * Skips binaries and enforces per-file and total size limits.
 */
object PromptAttachmentBundler {

    private const val MAX_PER_FILE_CHARS = 48_000
    private const val MAX_TOTAL_APPEND_CHARS = 180_000

    data class Result(val augmentedUserMessage: String, val summaryLines: List<String>)

    fun bundle(
        project: Project,
        basePrompt: String,
        files: List<VirtualFile>,
        indicator: ProgressIndicator?
    ): Result {
        if (files.isEmpty()) {
            return Result(basePrompt.trim(), emptyList())
        }
        val summary = mutableListOf<String>()
        val sb = StringBuilder()
        sb.append(basePrompt.trim())
        if (sb.isNotEmpty()) sb.appendLine().appendLine()

        var totalUsed = 0
        val ftm = FileTypeManager.getInstance()
        val relPathsForFooter = linkedSetOf<String>()

        for (file in files) {
            indicator?.checkCanceled()
            if (file.isDirectory) {
                summary.add("${file.name} (skipped: directory)")
                continue
            }
            if (shouldSkipFile(file, ftm)) {
                summary.add("${file.name} (skipped: binary or non-text type)")
                continue
            }
            val raw = try {
                String(file.contentsToByteArray(), StandardCharsets.UTF_8)
            } catch (_: Exception) {
                summary.add("${file.name} (skipped: read error)")
                continue
            }
            val truncated = if (raw.length > MAX_PER_FILE_CHARS) {
                raw.take(MAX_PER_FILE_CHARS) + "\n… [truncated at $MAX_PER_FILE_CHARS chars]"
            } else {
                raw
            }
            val rel = relativeProjectPath(project, file)
            if (rel != null) {
                relPathsForFooter.add(rel)
            }
            val pathLabel = rel ?: file.path
            val block = buildString {
                appendLine("--- File: $pathLabel ---")
                appendLine("```")
                appendLine(truncated.trimEnd())
                appendLine("```")
                appendLine()
            }
            if (totalUsed + block.length > MAX_TOTAL_APPEND_CHARS) {
                summary.add("${file.name} (skipped: total attachment budget reached)")
                continue
            }
            totalUsed += block.length
            sb.append(block)
            summary.add("${file.name} (${raw.length.coerceAtMost(MAX_PER_FILE_CHARS)} chars)")
        }

        if (relPathsForFooter.isNotEmpty()) {
            val footer = buildString {
                appendLine("--- Project-relative paths (use in LOCAL_LLM_PATCH / LOCAL_LLM_FILE `path=` attributes) ---")
                for (p in relPathsForFooter) {
                    appendLine("- $p")
                }
                appendLine()
            }
            if (totalUsed + footer.length <= MAX_TOTAL_APPEND_CHARS) {
                sb.append(footer)
                totalUsed += footer.length
            }
        }

        return Result(sb.toString().trimEnd(), summary)
    }

    private fun relativeProjectPath(project: Project, file: VirtualFile): String? {
        val base = project.basePath ?: return null
        return try {
            val bp = Paths.get(base).normalize()
            val fp = Paths.get(file.path).normalize()
            if (!fp.startsWith(bp)) return null
            bp.relativize(fp).toString().replace('\\', '/')
        } catch (_: Exception) {
            null
        }
    }

    private fun shouldSkipFile(file: VirtualFile, ftm: FileTypeManager): Boolean {
        if (file.fileType.isBinary) return true
        val t = ftm.getFileTypeByFileName(file.name)
        if (t is UnknownFileType && !looksLikeTextExtension(file.extension)) return true
        if (file.extension?.lowercase() in BINARY_EXT) return true
        return false
    }

    private val BINARY_EXT = setOf(
        "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tif", "tiff",
        "zip", "jar", "war", "ear", "7z", "rar", "gz", "bz2", "xz",
        "exe", "dll", "so", "dylib", "class", "o", "a",
        "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
        "mp3", "mp4", "wav", "avi", "mov", "webm",
        "ttf", "woff", "woff2", "eot"
    )

    private fun looksLikeTextExtension(ext: String?): Boolean {
        if (ext.isNullOrBlank()) return true
        val e = ext.lowercase()
        val textLike = setOf(
            "java", "kt", "kts", "xml", "json", "yml", "yaml", "properties", "gradle", "md", "txt",
            "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx", "vue", "svelte",
            "py", "rb", "go", "rs", "c", "h", "cpp", "hpp", "cc", "cxx", "cs", "fs", "sql",
            "sh", "bash", "zsh", "ps1", "bat", "cmd", "env", "gitignore", "dockerfile", "toml",
            "ini", "cfg", "conf", "log", "svg", "graphql", "gql"
        )
        return e in textLike || e.length <= 4
    }

}
