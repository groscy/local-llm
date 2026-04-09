package com.localllm.intellij

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Writes structured edits (full files and search/replace patches) under [Project.getBasePath].
 * Uses disk write + VFS refresh so new files appear; open editors reload from disk.
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
                    results.add(applyOne(base, StructuredApplyParser.FileBlock(e.path, e.content)))
                is StructuredApplyParser.StructuredEdit.Patch ->
                    results.add(applyPatch(base, e))
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
            results.add(applyOne(base, block))
        }
        return results
    }

    private fun applyPatch(basePath: String, patch: StructuredApplyParser.StructuredEdit.Patch): ApplyResult {
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
            var content = Files.readString(target, StandardCharsets.UTF_8)
            for ((hi, h) in patch.hunks.withIndex()) {
                val occ = countOccurrences(content, h.search)
                if (occ == 0) {
                    return ApplyResult(
                        patch.path,
                        false,
                        "Hunk ${hi + 1}/${patch.hunks.size}: SEARCH text not found (must match the file exactly)"
                    )
                }
                if (occ != 1) {
                    return ApplyResult(
                        patch.path,
                        false,
                        "Hunk ${hi + 1}/${patch.hunks.size}: SEARCH must match exactly once (found $occ times)"
                    )
                }
                content = content.replaceFirst(h.search, h.replace)
            }
            Files.writeString(target, content, StandardCharsets.UTF_8)
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile())
            if (vf != null) {
                val fdm = FileDocumentManager.getInstance()
                val doc = fdm.getDocument(vf)
                if (doc != null) {
                    fdm.reloadFromDisk(doc)
                } else {
                    vf.refresh(false, false)
                }
            }
            ApplyResult(patch.path, true, "${patch.hunks.size} patch hunk(s) applied")
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

    private fun applyOne(basePath: String, block: StructuredApplyParser.FileBlock): ApplyResult {
        val target = resolveUnderProject(basePath, block.path)
            ?: return ApplyResult(block.path, false, "Invalid or unsafe path (must be under project root)")
        return try {
            Files.createDirectories(target.parent)
            Files.writeString(target, block.content, StandardCharsets.UTF_8)
            val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile())
            if (vf != null) {
                val fdm = FileDocumentManager.getInstance()
                val doc = fdm.getDocument(vf)
                if (doc != null) {
                    fdm.reloadFromDisk(doc)
                } else {
                    vf.refresh(false, false)
                }
            }
            ApplyResult(block.path, true, "Written")
        } catch (e: Exception) {
            ApplyResult(block.path, false, e.message ?: e.toString())
        }
    }
}
