package com.localllm.intellij

import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile

/**
 * Shared apply path for chat and agent: structured + implicit attachment edits, inline output + notifications.
 */
object LocalLlmApplyCoordinator {

    fun collectEdits(modelReply: String): List<StructuredApplyParser.StructuredEdit> {
        val structured = StructuredApplyParser.parseStructuredEdits(modelReply)
        if (structured.isNotEmpty()) return structured
        return MarkdownFenceFileExtractor.parseFencedFullFiles(modelReply)
    }

    fun collectEditsWithImplicit(
        project: Project,
        modelReply: String,
        referencedFiles: List<VirtualFile>
    ): List<StructuredApplyParser.StructuredEdit> {
        var edits = collectEdits(modelReply)
        if (edits.isEmpty()) {
            edits = ImplicitAttachmentApply.inferEdits(project, modelReply, referencedFiles)
        }
        return edits
    }

    fun applyEditsIfAny(
        project: Project,
        applyEnabled: Boolean,
        previewBeforeApply: Boolean = true,
        modelReply: String,
        referencedFiles: List<VirtualFile>,
        appendTranscript: (String) -> Unit,
        appendTranscriptSection: (String, String) -> Unit,
        notifyDesktop: (kind: String, message: String?, meta: Map<String, Any?>) -> Unit,
        onComplete: () -> Unit
    ) {
        if (!applyEnabled) {
            onComplete()
            return
        }
        val edits = collectEditsWithImplicit(project, modelReply, referencedFiles)
        if (edits.isEmpty()) {
            onComplete()
            return
        }
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) {
                onComplete()
                return@invokeLater
            }
            if (previewBeforeApply) {
                val previewPaths = edits.take(8).joinToString("\n") { "• ${it.path}" }
                val more = if (edits.size > 8) "\n… and ${edits.size - 8} more" else ""
                val decision = Messages.showYesNoDialog(
                    project,
                    "Apply ${edits.size} proposed file edit(s)?\n\n$previewPaths$more",
                    "Local LLM — apply preview",
                    "Apply edits",
                    "Skip",
                    null
                )
                if (decision != Messages.YES) {
                    notifyDesktop(
                        PluginReportKind.APPLY_CANCELLED,
                        "User skipped previewed edits",
                        mapOf("project" to project.name, "filesTotal" to edits.size)
                    )
                    LocalLlmNotifications.notify(
                        project,
                        "Local LLM — apply",
                        "Skipped model file edits.",
                        NotificationType.INFORMATION
                    )
                    onComplete()
                    return@invokeLater
                }
            }
            try {
                val results = WriteCommandAction.writeCommandAction(project).compute<List<ProjectFileApplyService.ApplyResult>, RuntimeException> {
                    ProjectFileApplyService.applyStructuredEdits(project, edits)
                }
                val lines = results.joinToString("\n") { r ->
                    if (r.ok) "  ✓ ${r.path}" else "  ✗ ${r.path}: ${r.message}"
                }
                appendTranscriptSection("Apply results", lines)
                val okN = results.count { it.ok }
                val failN = results.size - okN
                notifyDesktop(
                    PluginReportKind.APPLY_COMPLETED,
                    "${project.name}: $okN ok, $failN failed",
                    mapOf(
                        "project" to project.name,
                        "filesTotal" to results.size,
                        "filesOk" to okN,
                        "filesFailed" to failN
                    )
                )
                val type = if (failN > 0) NotificationType.WARNING else NotificationType.INFORMATION
                LocalLlmNotifications.notify(
                    project,
                    "Local LLM — apply",
                    "$okN file(s) updated, $failN failed.",
                    type
                )
                val base = project.basePath
                if (base != null) {
                    results.filter { it.ok }.forEachIndexed { idx, r ->
                        val target = ProjectFileApplyService.resolveUnderProject(base, r.path) ?: return@forEachIndexed
                        if (!target.toFile().exists()) return@forEachIndexed
                        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile()) ?: return@forEachIndexed
                        FileEditorManager.getInstance(project).openFile(vf, idx == 0)
                    }
                }
            } catch (e: Exception) {
                notifyDesktop(PluginReportKind.APPLY_FAILED, e.message?.take(200), mapOf("project" to project.name))
                appendTranscript("Apply error: ${e.message ?: e}\n\n")
            }
            onComplete()
        }
    }
}
