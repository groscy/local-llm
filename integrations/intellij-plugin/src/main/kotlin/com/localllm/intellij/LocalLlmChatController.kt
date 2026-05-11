package com.localllm.intellij

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Chat send / clarify / structured-apply orchestration. HTTP usage matches the desktop integration server contract.
 */
class LocalLlmChatController(
    private val project: Project,
    private val compose: LocalLlmComposePanel,
    private val refreshConnection: () -> Unit,
    private val finishSendTurn: (success: Boolean) -> Unit
) {

    private data class LastSendSnapshot(
        val promptText: String,
        val filePaths: List<String>,
        val includeGraph: Boolean
    )

    private var lastSendSnapshot: LastSendSnapshot? = null

    /**
     * Prior user/assistant turns sent to POST /v1/chat, mirroring the desktop chat’s message list
     * (system + history + new user on each send).
     */
    private val apiHistory = mutableListOf<LocalLlmHttpClient.ChatMessage>()

    private fun endSendTurn(success: Boolean) {
        ApplicationManager.getApplication().invokeLater {
            finishSendTurn(success)
        }
    }

    fun resendLastMessage() {
        val snap = lastSendSnapshot ?: return
        compose.promptArea.text = snap.promptText
        compose.includeGraph.isSelected = snap.includeGraph
        compose.fileModel.clear()
        val fs = LocalFileSystem.getInstance()
        for (p in snap.filePaths) {
            val vf = fs.findFileByPath(p)
            if (vf != null && !vf.isDirectory) compose.addFileUnique(vf)
        }
        sendToModel()
    }

    fun sendToModel() {
        val question = compose.promptArea.text.trim()
        val files = compose.snapshotFilesForSend()
        if (question.isBlank() && files.isEmpty()) {
            Messages.showWarningDialog(
                project,
                "Enter a message and/or attach at least one file.",
                "Local LLM"
            )
            return
        }

        lastSendSnapshot = LastSendSnapshot(
            promptText = compose.promptArea.text,
            filePaths = files.map { it.path },
            includeGraph = compose.includeGraph.isSelected
        )

        val port = LocalLlmIntegrationProperties.integrationPort()
        val token = LocalLlmIntegrationProperties.integrationToken()

        compose.setProgress("Queued: prompt + ${files.size} attachment(s)")

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Local LLM", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val basePrompt = if (question.isBlank()) {
                        "Respond to the attached files."
                    } else {
                        question
                    }
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) compose.setProgress("Preparing prompt…")
                    }
                    indicator.text = "Preparing message…"
                    val bundled = ApplicationManager.getApplication().runReadAction<PromptAttachmentBundler.Result> {
                        PromptAttachmentBundler.bundle(project, basePrompt, files, indicator)
                    }
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) compose.setProgress("Prompt prepared")
                    }
                    trimHistoryIfNeeded()
                    val graphText = if (compose.includeGraph.isSelected) {
                        indicator.text = "Building knowledge graph…"
                        ApplicationManager.getApplication().runReadAction<String> {
                            KnowledgeGraphCollector.collect(project, indicator)
                        }
                    } else {
                        ""
                    }
                    val messages = mutableListOf(
                        LocalLlmHttpClient.ChatMessage("system", LocalLlmSystemPrompts.build(graphText))
                    )
                    messages.addAll(apiHistory)
                    messages.add(LocalLlmHttpClient.ChatMessage("user", bundled.augmentedUserMessage))
                    indicator.text = "Submitting background job…"
                    val submitted = LocalLlmHttpClient.submitJob(
                        port = port,
                        token = token,
                        messages = messages,
                        projectName = project.name,
                        projectBasePath = project.basePath
                    )
                    notifyDesktop(
                        PluginReportKind.CHAT_JOB_QUEUED,
                        "Queued ${submitted.jobId}",
                        mapOf("project" to project.name, "jobId" to submitted.jobId, "attachments" to files.size)
                    )
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            compose.setProgress("Background job queued: ${submitted.jobId.take(8)}")
                            LocalLlmNotifications.notify(
                                project,
                                "Local LLM",
                                "Prompt is running in background.",
                                com.intellij.notification.NotificationType.INFORMATION
                            )
                            endSendTurn(true)
                        }
                    }
                    pollJobUntilDone(
                        indicator = indicator,
                        port = port,
                        token = token,
                        submitted = submitted,
                        messagesSent = messages,
                        includeGraph = compose.includeGraph.isSelected,
                        attachmentCount = files.size,
                        referencedFiles = files
                    )
                } catch (_: ProcessCanceledException) {
                    ApplicationManager.getApplication().invokeLater {
                        notifyDesktop(PluginReportKind.SEND_CANCELLED, "Send cancelled", mapOf("project" to project.name))
                        compose.setProgress("Cancelled")
                        endSendTurn(false)
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        val net = e is IOException || LocalLlmHttpClient.isConnectFailure(e)
                        if (net) {
                            notifyDesktop(
                                PluginReportKind.CHAT_FAILED,
                                e.message?.take(200),
                                mapOf("project" to project.name, "reason" to "prepare_or_network")
                            )
                            compose.setProgressError("Connection failed (127.0.0.1:$port)")
                            refreshConnection()
                        } else {
                            notifyDesktop(PluginReportKind.CHAT_FAILED, e.message?.take(200), mapOf("project" to project.name))
                            compose.setProgressError("Error: ${e.javaClass.simpleName}")
                            Messages.showErrorDialog(project, e.message ?: e.toString(), "Local LLM")
                        }
                        endSendTurn(false)
                    }
                }
            }
        })
    }

    fun generateDomainVocabulary() {
        val attached = compose.snapshotFiles()
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Domain vocabulary", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    indicator.text = "Scanning Java/Kotlin sources…"
                    val report = ApplicationManager.getApplication().runReadAction<DomainVocabularyCollector.VocabularyReport> {
                        DomainVocabularyCollector.collect(project, indicator, attached)
                    }
                    ApplicationManager.getApplication().invokeLater {
                        if (project.isDisposed) return@invokeLater
                        DomainVocabularyDialog(project, report.markdown).show()
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            Messages.showErrorDialog(project, e.message ?: e.toString(), "Domain vocabulary")
                        }
                    }
                }
            }
        })
    }

    fun hasLastSendSnapshot(): Boolean = lastSendSnapshot != null

    fun clearConversation() {
        apiHistory.clear()
        ApplicationManager.getApplication().invokeLater {
            if (!project.isDisposed) compose.clearOutput()
        }
    }

    /** Drop oldest turns so the bridge payload stays bounded. */
    private fun trimHistoryIfNeeded() {
        val maxChars = 300_000
        while (apiHistory.size >= 2) {
            val total = apiHistory.sumOf { it.content.length }
            if (total <= maxChars) return
            apiHistory.removeAt(0)
            apiHistory.removeAt(0)
        }
    }

    private fun notifyDesktop(kind: String, message: String?, meta: Map<String, Any?> = emptyMap()) {
        LocalLlmPluginReports.postAsync(project, kind, message, meta)
    }

    private fun pollJobUntilDone(
        indicator: ProgressIndicator,
        port: Int,
        token: String,
        submitted: LocalLlmHttpClient.JobSubmitted,
        messagesSent: List<LocalLlmHttpClient.ChatMessage>,
        includeGraph: Boolean,
        attachmentCount: Int,
        referencedFiles: List<VirtualFile>
    ) {
        var status = submitted.status
        while (true) {
            indicator.checkCanceled()
            val snap = LocalLlmHttpClient.fetchJobStatus(port, token, submitted.jobId)
            status = snap.status
            ApplicationManager.getApplication().invokeLater {
                if (!project.isDisposed) compose.setProgress("Job ${submitted.jobId.take(8)}: ${snap.progress ?: snap.status}")
            }
            when (status) {
                "queued", "running" -> {
                    Thread.sleep(1400)
                    continue
                }
                "completed" -> {
                    val result = LocalLlmHttpClient.fetchJobResult(port, token, submitted.jobId)
                    val assistantRecorded = (ApplyReplyExtractor.applyPayloadOnlyOrNull(result.reply) ?: result.reply).trim()
                    val tail = messagesSent.drop(1).toMutableList()
                    tail.add(LocalLlmHttpClient.ChatMessage("assistant", assistantRecorded))
                    apiHistory.clear()
                    apiHistory.addAll(tail)
                    val meta = mutableMapOf<String, Any?>(
                        "project" to project.name,
                        "attachments" to attachmentCount,
                        "includeGraph" to includeGraph,
                        "jobId" to submitted.jobId
                    )
                    result.promptTokens?.let { meta["promptTokens"] = it }
                    result.completionTokens?.let { meta["completionTokens"] = it }
                    notifyDesktop(PluginReportKind.CHAT_COMPLETED, project.name, meta)
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            compose.setProgress("Background job completed")
                            LocalLlmNotifications.notify(
                                project,
                                "Local LLM",
                                "Background prompt finished.",
                                com.intellij.notification.NotificationType.INFORMATION
                            )
                        }
                    }
                    offerApplyStructuredEdits(assistantRecorded, referencedFiles) {}
                    return
                }
                "failed", "cancelled" -> {
                    notifyDesktop(
                        PluginReportKind.CHAT_FAILED,
                        snap.error?.take(200) ?: "Job $status",
                        mapOf("project" to project.name, "jobId" to submitted.jobId, "status" to status)
                    )
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            compose.setProgressError("Background job $status")
                            LocalLlmNotifications.notify(
                                project,
                                "Local LLM",
                                "Background prompt $status${snap.error?.let { ": $it" } ?: "."}",
                                com.intellij.notification.NotificationType.WARNING
                            )
                        }
                    }
                    return
                }
                else -> {
                    throw IllegalStateException("Unknown job status: $status")
                }
            }
        }
    }

    private fun runChatWithOptionalClarify(
        indicator: ProgressIndicator,
        port: Int,
        token: String,
        userMessage: String,
        includeGraph: Boolean,
        attachmentCount: Int,
        referencedFiles: List<VirtualFile>,
        onLog: (String) -> Unit
    ) {
        onLog("Building context…")
        val graphText = if (includeGraph) {
            indicator.text = "Building knowledge graph…"
            ApplicationManager.getApplication().runReadAction<String> {
                KnowledgeGraphCollector.collect(project, indicator)
            }
        } else {
            ""
        }

        trimHistoryIfNeeded()
        val messages = mutableListOf(
            LocalLlmHttpClient.ChatMessage("system", LocalLlmSystemPrompts.build(graphText))
        )
        messages.addAll(apiHistory)
        messages.add(LocalLlmHttpClient.ChatMessage("user", userMessage))

        var round = 0
        while (round < 3) {
            indicator.checkCanceled()
            indicator.text = "Waiting for local model…"
            onLog("Waiting for model response…")
            val completion = try {
                LocalLlmHttpClient.chat(port, token, messages)
            } catch (e: LocalLlmHttpClient.LocalLlmHttpException) {
                notifyDesktop(
                    PluginReportKind.CHAT_FAILED,
                    "HTTP ${e.status}",
                    mapOf("project" to project.name, "httpStatus" to e.status)
                )
                onLog("Request failed: HTTP ${e.status}")
                ApplicationManager.getApplication().invokeLater { refreshConnection() }
                endSendTurn(false)
                return
            } catch (e: IOException) {
                notifyDesktop(
                    PluginReportKind.CHAT_FAILED,
                    e.message?.take(200),
                    mapOf("project" to project.name, "reason" to "io")
                )
                onLog("Connection failed (127.0.0.1:$port)")
                ApplicationManager.getApplication().invokeLater { refreshConnection() }
                endSendTurn(false)
                return
            } catch (e: Exception) {
                if (LocalLlmHttpClient.isConnectFailure(e)) {
                    notifyDesktop(
                        PluginReportKind.CHAT_FAILED,
                        e.message?.take(200),
                        mapOf("project" to project.name, "reason" to "connect")
                    )
                    onLog("Connection failed (127.0.0.1:$port)")
                    ApplicationManager.getApplication().invokeLater { refreshConnection() }
                    endSendTurn(false)
                    return
                }
                throw e
            }

            when (val parsed = ClarifyResponseParser.parse(completion.reply)) {
                is ClarifyResponseParser.Parsed.DirectAnswer -> {
                    val payloadOnly = ApplyReplyExtractor.applyPayloadOnlyOrNull(completion.reply)
                    val assistantRecorded = (payloadOnly ?: completion.reply).trim()
                    val tail = messages.drop(1).toMutableList()
                    tail.add(LocalLlmHttpClient.ChatMessage("assistant", assistantRecorded))
                    apiHistory.clear()
                    apiHistory.addAll(tail)

                    onLog("Model response received")
                    val meta = mutableMapOf<String, Any?>(
                        "project" to project.name,
                        "attachments" to attachmentCount,
                        "includeGraph" to includeGraph,
                        "clarificationRounds" to round
                    )
                    completion.promptTokens?.let { meta["promptTokens"] = it }
                    completion.completionTokens?.let { meta["completionTokens"] = it }
                    notifyDesktop(PluginReportKind.CHAT_COMPLETED, project.name, meta)
                    onLog("Applying edits…")
                    offerApplyStructuredEdits(assistantRecorded, referencedFiles) { endSendTurn(true) }
                    return
                }
                is ClarifyResponseParser.Parsed.NeedsClarification -> {
                    val latch = CountDownLatch(1)
                    var answerLines: List<String>? = null
                    ApplicationManager.getApplication().invokeLater {
                        try {
                            onLog("Waiting for clarification…")
                            val dlg = ClarifyQuestionsDialog(project, parsed.questions)
                            if (dlg.showAndGet()) {
                                answerLines = dlg.answersLines()
                            }
                        } finally {
                            latch.countDown()
                        }
                    }
                    if (!latch.await(15, TimeUnit.MINUTES)) {
                        notifyDesktop(PluginReportKind.SEND_CANCELLED, "Clarification timed out", mapOf("project" to project.name))
                        onLog("(Timed out waiting for clarification.)\n\n")
                        endSendTurn(false)
                        return
                    }
                    val lines = answerLines
                    if (lines == null) {
                        notifyDesktop(PluginReportKind.SEND_CANCELLED, "Clarification cancelled", mapOf("project" to project.name))
                        onLog("Cancelled")
                        endSendTurn(false)
                        return
                    }
                    messages.add(LocalLlmHttpClient.ChatMessage("assistant", completion.reply))
                    messages.add(LocalLlmHttpClient.ChatMessage("user", "My clarifications:\n${lines.joinToString("\n")}"))
                    onLog("Clarification submitted; retrying…")
                    round++
                }
            }
        }
        notifyDesktop(PluginReportKind.CHAT_FAILED, "Max clarification rounds", mapOf("project" to project.name))
        onLog("Failed: max clarification rounds reached")
        endSendTurn(false)
    }

    private fun offerApplyStructuredEdits(
        modelReply: String,
        referencedFiles: List<VirtualFile>,
        onDone: () -> Unit
    ) {
        LocalLlmApplyCoordinator.applyEditsIfAny(
            project = project,
            applyEnabled = compose.applyStructuredEdits.isSelected,
            modelReply = modelReply,
            referencedFiles = referencedFiles,
            appendTranscript = { line ->
                if (!project.isDisposed && line.contains("error", ignoreCase = true)) {
                    compose.setProgressError("Apply failed")
                }
            },
            appendTranscriptSection = { _, body ->
                if (!project.isDisposed) {
                    val ok = Regex("""^\s*✓\s""", RegexOption.MULTILINE).findAll(body).count()
                    val fail = Regex("""^\s*✗\s""", RegexOption.MULTILINE).findAll(body).count()
                    if (fail > 0) compose.setProgressError("Apply finished: $ok ok, $fail failed")
                    else compose.setProgress("Apply finished: $ok ok")
                }
            },
            notifyDesktop = { kind, message, meta -> notifyDesktop(kind, message, meta) },
            onComplete = {
                if (!project.isDisposed) compose.setProgress("Done")
                onDone()
            }
        )
    }
}
