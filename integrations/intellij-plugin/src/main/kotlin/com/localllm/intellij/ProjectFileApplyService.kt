package com.localllm.intellij

import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.Paths

/**
 * Writes full-file contents for paths that resolve under [Project.getBasePath].
 * Uses disk write + VFS refresh so new files appear; open editors reload from disk.
 * Call from [com.intellij.openapi.command.WriteCommandAction] on the EDT.
 */
object ProjectFileApplyService {

    data class ApplyResult(val path: String, val ok: Boolean, val message: String)

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
