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
 * Shared apply path for chat and agent: structured + implicit attachment edits, transcript + notifications.
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
            if (LocalLlmIntegrationProperties.confirmBeforeFileApply()) {
                val summary = edits.joinToString("\n") { e ->
                    when (e) {
                        is StructuredApplyParser.StructuredEdit.Patch ->
                            "PATCH ${e.path} (${e.hunks.size} hunk(s))"
                        is StructuredApplyParser.StructuredEdit.FullFile ->
                            "FILE ${e.path}"
                    }
                }
                val ok = Messages.showYesNoDialog(
                    project,
                    "Apply the following to the project?\n\n$summary",
                    "Local LLM — confirm apply",
                    Messages.getQuestionIcon()
                )
                if (ok != Messages.YES) {
                    appendTranscript("(Apply cancelled — confirmation declined.)\n\n")
                    notifyDesktop(
                        PluginReportKind.APPLY_CANCELLED,
                        "User declined confirm dialog",
                        mapOf("project" to project.name, "edits" to edits.size)
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
                    "$okN file(s) updated, $failN failed. See transcript for details.",
                    type
                )
                if (results.any { !it.ok }) {
                    Messages.showWarningDialog(
                        project,
                        "Some edits could not be applied. See the conversation log for details.",
                        "Local LLM"
                    )
                }
                val base = project.basePath
                if (base != null) {
                    results.filter { it.ok }.forEachIndexed { idx, r ->
                        val target = ProjectFileApplyService.resolveUnderProject(base, r.path) ?: return@forEachIndexed
                        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile()) ?: return@forEachIndexed
                        FileEditorManager.getInstance(project).openFile(vf, idx == 0)
                    }
                }
            } catch (e: Exception) {
                notifyDesktop(PluginReportKind.APPLY_FAILED, e.message?.take(200), mapOf("project" to project.name))
                appendTranscript("Apply error: ${e.message ?: e}\n\n")
                Messages.showErrorDialog(project, e.message ?: e.toString(), "Local LLM")
            }
            onComplete()
        }
    }
}
