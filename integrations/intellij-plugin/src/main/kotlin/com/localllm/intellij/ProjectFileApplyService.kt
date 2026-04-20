package com.localllm.intellij

import com.intellij.openapi.editor.Document
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiDocumentManager
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Applies structured edits under [Project.getBasePath].
 * When a [Document] exists for the target file (typically an open or cached editor), changes are written **into that
 * buffer** so the user sees the model output directly in the editor with normal undo. Otherwise falls back to disk.
 * Call from [com.intellij.openapi.command.WriteCommandAction] on the EDT.
 */
object ProjectFileApplyService {

    data class ApplyResult(val path: String, val ok: Boolean, val message: String)

    fun applyStructuredEdits(project: Project, edits: List<StructuredApplyParser.StructuredEdit>): List<ApplyResult> {
        val base = project.basePath
            ?: return edits.map { e -> ApplyResult(e.path, false, "Project has no base path") }
        val results = ArrayList<ApplyResult>(edits.size)
        for (e in edits) {
            when (e) {
                is StructuredApplyParser.StructuredEdit.FullFile ->
                    results.add(applyOne(project, base, StructuredApplyParser.FileBlock(e.path, e.content)))
                is StructuredApplyParser.StructuredEdit.Patch ->
                    results.add(applyPatch(project, base, e))
            }
        }
        return results
    }

    fun resolveUnderProject(basePath: String, relativePath: String): Path? {
        val base = Paths.get(basePath).normalize()
        val rel = relativePath.trim().replace('\\', '/').trimStart('/')
        if (rel.isEmpty() || rel.contains("..")) return null
        val target = base.resolve(rel).normalize()
        if (!target.startsWith(base)) return null
        return target
    }

    fun applyAll(project: Project, blocks: List<StructuredApplyParser.FileBlock>): List<ApplyResult> {
        val base = project.basePath
            ?: return blocks.map { b -> ApplyResult(b.path, false, "Project has no base path") }
        val results = ArrayList<ApplyResult>(blocks.size)
        for (block in blocks) {
            results.add(applyOne(project, base, block))
        }
        return results
    }

    private fun documentText(document: Document): String =
        if (document.textLength == 0) "" else document.getText(TextRange(0, document.textLength))

    /**
     * Aligns patch SEARCH with editor/disk text: IDEA documents use `\n`; models often emit `\r\n`;
     * Windows files on disk may be CRLF. Also strips a leading UTF-8 BOM so SEARCH from copied content matches.
     */
    private fun normalizeForPatchMatch(text: String): String {
        var t = text.replace("\r\n", "\n").replace('\r', '\n')
        if (t.startsWith('\uFEFF')) {
            t = t.substring(1)
        }
        return t
    }

    private fun applyTextToDocument(project: Project, document: Document, newText: String) {
        if (documentText(document) == newText) return
        document.replaceString(0, document.textLength, newText)
        PsiDocumentManager.getInstance(project).commitDocument(document)
    }

    private fun applyPatch(project: Project, basePath: String, patch: StructuredApplyParser.StructuredEdit.Patch): ApplyResult {
        val target = resolveUnderProject(basePath, patch.path)
            ?: return ApplyResult(patch.path, false, "Invalid or unsafe path (must be under project root)")
        if (!Files.exists(target)) {
            return ApplyResult(
                patch.path,
                false,
                "File does not exist yet — use LOCAL_LLM_FILE to add new files, or create the file first"
            )
        }
        return try {
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile())
                ?: return ApplyResult(patch.path, false, "Cannot resolve file in VFS")
            val doc = FileDocumentManager.getInstance().getDocument(vf)
            var content = if (doc != null) {
                documentText(doc)
            } else {
                Files.readString(target, StandardCharsets.UTF_8)
            }
            content = normalizeForPatchMatch(content)
            for ((hi, h) in patch.hunks.withIndex()) {
                var search = normalizeForPatchMatch(h.search)
                var replace = normalizeForPatchMatch(h.replace)
                var occ = countOccurrences(content, search)
                if (occ == 0) {
                    // Model / Windows: trailing newline mismatch on the SEARCH block
                    if (search.endsWith('\n')) {
                        val s2 = search.trimEnd('\n')
                        val r2 = if (replace.endsWith('\n')) replace.trimEnd('\n') else replace
                        if (countOccurrences(content, s2) == 1) {
                            search = s2
                            replace = r2
                            occ = 1
                        }
                    }
                    if (occ == 0 && !search.endsWith('\n') && countOccurrences(content, "$search\n") == 1) {
                        search = "$search\n"
                        replace = if (replace.endsWith('\n')) replace else "$replace\n"
                        occ = 1
                    }
                }
                if (occ == 0) {
                    return ApplyResult(
                        patch.path,
                        false,
                        "Hunk ${hi + 1}/${patch.hunks.size}: SEARCH text not found after normalizing line endings (CRLF/LF) " +
                            "and BOM — copy SEARCH from the exact file buffer the model saw, including spaces and newlines."
                    )
                }
                if (occ != 1) {
                    return ApplyResult(
                        patch.path,
                        false,
                        "Hunk ${hi + 1}/${patch.hunks.size}: SEARCH must match exactly once (found $occ times)"
                    )
                }
                content = content.replaceFirst(search, replace)
            }
            if (doc != null) {
                applyTextToDocument(project, doc, content)
                ApplyResult(patch.path, true, "${patch.hunks.size} hunk(s) applied in editor")
            } else {
                Files.writeString(target, content, StandardCharsets.UTF_8)
                vf.refresh(false, false)
                ApplyResult(patch.path, true, "${patch.hunks.size} patch hunk(s) written to disk")
            }
        } catch (e: Exception) {
            ApplyResult(patch.path, false, e.message ?: e.toString())
        }
    }

    private fun countOccurrences(haystack: String, needle: String): Int {
        if (needle.isEmpty()) return 0
        var c = 0
        var i = 0
        while (i <= haystack.length - needle.length) {
            val j = haystack.indexOf(needle, i)
            if (j < 0) break
            c++
            i = j + needle.length
        }
        return c
    }

    private fun applyOne(project: Project, basePath: String, block: StructuredApplyParser.FileBlock): ApplyResult {
        val target = resolveUnderProject(basePath, block.path)
            ?: return ApplyResult(block.path, false, "Invalid or unsafe path (must be under project root)")
        return try {
            Files.createDirectories(target.parent)
            val preExisted = Files.exists(target)
            if (!preExisted) {
                Files.writeString(target, block.content, StandardCharsets.UTF_8)
            }
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile())
                ?: return ApplyResult(block.path, false, "Cannot locate file in VFS")
            val doc = FileDocumentManager.getInstance().getDocument(vf)
            if (doc != null) {
                if (documentText(doc) != block.content) {
                    applyTextToDocument(project, doc, block.content)
                }
                val msg = if (preExisted) "Replaced in editor" else "Created (editor buffer)"
                return ApplyResult(block.path, true, msg)
            }
            if (preExisted) {
                Files.writeString(target, block.content, StandardCharsets.UTF_8)
            }
            vf.refresh(false, false)
            ApplyResult(block.path, true, "Written to disk")
        } catch (e: Exception) {
            ApplyResult(block.path, false, e.message ?: e.toString())
        }
    }
}
