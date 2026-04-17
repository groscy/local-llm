package com.localllm.intellij

import com.google.gson.JsonObject
import com.intellij.openapi.application.runReadAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.EmptyProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.VfsUtilCore
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Paths

private const val READ_CAP = 96_000
private const val LIST_CAP = 200
private const val SEARCH_MAX_FILES = 400
private const val SEARCH_MAX_FILE_BYTES = 256_000
private const val SEARCH_MAX_RESULTS = 60

private fun readProjectFileText(project: Project, relativePath: String): String? {
    val base = project.basePath ?: return null
    val target = ProjectFileApplyService.resolveUnderProject(base, relativePath) ?: return null
    if (!Files.isRegularFile(target)) return null
    val bytes = Files.readAllBytes(target)
    if (bytes.size > READ_CAP + 1) {
        return String(bytes, 0, READ_CAP, StandardCharsets.UTF_8) + "\n… [truncated at $READ_CAP bytes]"
    }
    return String(bytes, StandardCharsets.UTF_8)
}

class ReadFileAgentTool : AgentTool {
    override val name = "read_file"
    override val description = "Read a UTF-8 text file under the project root (args: path relative to project)."

    override fun execute(project: Project, args: JsonObject): String {
        val path = args.get("path")?.asString?.trim() ?: return "error: missing path"
        val text = readProjectFileText(project, path) ?: return "error: cannot read path (missing, binary, or outside project): $path"
        return text
    }
}

class ListDirAgentTool : AgentTool {
    override val name = "list_dir"
    override val description = "List files and directories (args: path relative to project, default \"\" for content roots)."

    override fun execute(project: Project, args: JsonObject): String {
        val rel = args.get("path")?.asString?.trim().orEmpty()
        val base = project.basePath ?: return "error: no project base path"
        val dir = if (rel.isEmpty()) {
            Paths.get(base)
        } else {
            ProjectFileApplyService.resolveUnderProject(base, rel) ?: return "error: invalid path"
        }
        if (!Files.isDirectory(dir)) return "error: not a directory: $rel"
        val names = ArrayList<String>()
        Files.newDirectoryStream(dir).use { stream ->
            for (p in stream) {
                names.add(p.fileName.toString() + if (Files.isDirectory(p)) "/" else "")
            }
        }
        names.sort()
        val truncated = names.size > LIST_CAP
        val shown = if (truncated) names.take(LIST_CAP) else names
        return buildString {
            appendLine(if (rel.isEmpty()) "(content root)" else rel)
            shown.forEach { appendLine(it) }
            if (truncated) appendLine("… [truncated at $LIST_CAP entries]")
        }.trimEnd()
    }
}

class SearchInProjectAgentTool : AgentTool {
    override val name = "search_in_project"
    override val description =
        "Search for a literal substring in text files under content roots (args: pattern string, optional maxResults int default 40)."

    override fun execute(project: Project, args: JsonObject): String {
        val pattern = args.get("pattern")?.asString ?: return "error: missing pattern"
        if (pattern.isEmpty()) return "error: empty pattern"
        val maxResults = args.get("maxResults")?.asInt?.coerceIn(1, SEARCH_MAX_RESULTS) ?: 40
        return runReadAction<String> {
            val roots = ProjectRootManager.getInstance(project).contentRoots.filter { it.isValid }
            val hits = ArrayList<String>()
            var filesVisited = 0
            outer@ for (root in roots) {
                VfsUtilCore.iterateChildrenRecursively(root, null) { file ->
                    if (hits.size >= maxResults) return@iterateChildrenRecursively false
                    if (file.isDirectory) return@iterateChildrenRecursively true
                    filesVisited++
                    if (filesVisited > SEARCH_MAX_FILES) return@iterateChildrenRecursively false
                    if (file.length > SEARCH_MAX_FILE_BYTES) return@iterateChildrenRecursively true
                    val ext = (file.extension ?: "").lowercase()
                    if (ext !in SEARCHABLE_EXT) return@iterateChildrenRecursively true
                    val text = try {
                        val doc = FileDocumentManager.getInstance().getDocument(file)
                        if (doc != null) {
                            if (doc.textLength == 0) "" else doc.getText(TextRange(0, doc.textLength))
                        } else {
                            String(file.contentsToByteArray(), StandardCharsets.UTF_8)
                        }
                    } catch (_: Exception) {
                        return@iterateChildrenRecursively true
                    }
                    if (text.isEmpty()) return@iterateChildrenRecursively true
                    val rel = PromptAttachmentBundler.relativeProjectPath(project, file) ?: file.path
                    var idx = 0
                    while (idx < text.length && hits.size < maxResults) {
                        val j = text.indexOf(pattern, idx)
                        if (j < 0) break
                        val lineStart = text.lastIndexOf('\n', j).let { if (it < 0) 0 else it + 1 }
                        val lineEnd = text.indexOf('\n', j + pattern.length).let { if (it < 0) text.length else it }
                        val line = text.substring(lineStart, lineEnd.coerceAtMost(lineStart + 240))
                        hits.add("$rel:${1 + text.substring(0, j).count { it == '\n' }}: $line")
                        idx = j + pattern.length
                    }
                    true
                }
            }
            if (hits.isEmpty()) return@runReadAction "(no matches)"
            hits.joinToString("\n")
        }
    }

    private val SEARCHABLE_EXT = setOf(
        "java", "kt", "kts", "xml", "json", "gradle", "md", "txt", "properties", "yml", "yaml",
        "html", "htm", "css", "scss", "js", "jsx", "ts", "tsx", "sql", "py", "go", "rs", "c", "h", "cpp", "hpp", "cs"
    )
}

class GetOpenFileAgentTool : AgentTool {
    override val name = "get_open_file"
    override val description = "Paths and short preview of currently selected editor files (no args)."

    @Suppress("UNUSED_PARAMETER")
    override fun execute(project: Project, args: JsonObject): String {
        return runReadAction<String> {
            val files = FileEditorManager.getInstance(project).selectedFiles
            if (files.isEmpty()) return@runReadAction "(no open editor selection)"
            buildString {
                for (f in files) {
                    val rel = PromptAttachmentBundler.relativeProjectPath(project, f) ?: f.path
                    appendLine("--- $rel ---")
                    val doc = FileDocumentManager.getInstance().getDocument(f)
                    val preview = if (doc != null && doc.textLength > 0) {
                        val n = minOf(1200, doc.textLength)
                        doc.getText(TextRange(0, n)) + if (doc.textLength > n) "\n…" else ""
                    } else {
                        try {
                            val raw = String(f.contentsToByteArray(), StandardCharsets.UTF_8)
                            raw.take(1200) + if (raw.length > 1200) "\n…" else ""
                        } catch (e: Exception) {
                            "(cannot read: ${e.message})"
                        }
                    }
                    appendLine(preview.trimEnd())
                    appendLine()
                }
            }.trimEnd()
        }
    }
}

class ReadSelectionAgentTool : AgentTool {
    override val name = "read_selection"
    override val description = "Selected text in the active editor (no args)."

    @Suppress("UNUSED_PARAMETER")
    override fun execute(project: Project, args: JsonObject): String {
        return runReadAction<String> {
            val editor = FileEditorManager.getInstance(project).selectedTextEditor
                ?: return@runReadAction "(no active editor)"
            val text = getSelectedText(editor)
            if (text.isNullOrBlank()) return@runReadAction "(empty selection)"
            if (text.length > 32_000) text.take(32_000) + "\n… [truncated]"
            else text
        }
    }

    private fun getSelectedText(editor: Editor): String? {
        val s = editor.selectionModel.selectionStart
        val e = editor.selectionModel.selectionEnd
        if (s == e) return null
        return editor.document.getText(TextRange(s, e))
    }
}

class KnowledgeGraphAgentTool : AgentTool {
    override val name = "get_knowledge_graph"
    override val description = "Structural Java/Kotlin graph for the project (no args; may be large)."

    @Suppress("UNUSED_PARAMETER")
    override fun execute(project: Project, args: JsonObject): String {
        return runReadAction<String> {
            KnowledgeGraphCollector.collect(project, EmptyProgressIndicator())
        }
    }
}
