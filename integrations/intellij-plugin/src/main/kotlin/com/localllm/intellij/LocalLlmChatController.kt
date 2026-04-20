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
    private val transcript: LocalLlmTranscriptPanel,
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
        val files = compose.snapshotFiles()
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

        // Prompt text stays in the compose area — do not duplicate it in the transcript.
        val youLine = buildString {
            append("You")
            when {
                files.isNotEmpty() && question.isNotEmpty() ->
                    append(" · ${files.size} file(s) attached")
                files.isNotEmpty() ->
                    append(" · ${files.size} file(s) only (no extra message text)")
            }
        }
        transcript.append("$youLine\n\n")

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Local LLM", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val basePrompt = if (question.isBlank()) {
                        "Respond to the attached files."
                    } else {
                        question
                    }
                    indicator.text = "Preparing message…"
                    val bundled = ApplicationManager.getApplication().runReadAction<PromptAttachmentBundler.Result> {
                        PromptAttachmentBundler.bundle(project, basePrompt, files, indicator)
                    }
                    if (bundled.summaryLines.isNotEmpty()) {
                        val summary = bundled.summaryLines.joinToString("\n") { "  · $it" }
                        ApplicationManager.getApplication().invokeLater {
                            transcript.appendSection("Attachments", summary)
                        }
                    }

                    runChatWithOptionalClarify(
                        indicator = indicator,
                        port = port,
                        token = token,
                        userMessage = bundled.augmentedUserMessage,
                        includeGraph = compose.includeGraph.isSelected,
                        attachmentCount = files.size,
                        referencedFiles = files,
                        onLog = { line ->
                            ApplicationManager.getApplication().invokeLater { transcript.append(line) }
                        }
                    )
                } catch (_: ProcessCanceledException) {
                    ApplicationManager.getApplication().invokeLater {
                        notifyDesktop(PluginReportKind.SEND_CANCELLED, "Send cancelled", mapOf("project" to project.name))
                        transcript.append("(Cancelled.)\n\n")
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
                            transcript.append(
                                "Connection error · 127.0.0.1:$port · ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                                    "See the status strip at the top of this tool window. Enable IDE integration in Local LLM Desktop.\n\n"
                            )
                            refreshConnection()
                        } else {
                            notifyDesktop(PluginReportKind.CHAT_FAILED, e.message?.take(200), mapOf("project" to project.name))
                            transcript.append("Error: ${e.message ?: e}\n\n")
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
            if (!project.isDisposed) transcript.clearTranscript()
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

    private fun formatTokenUsageLine(
        completion: LocalLlmHttpClient.ChatCompletion,
        messages: List<LocalLlmHttpClient.ChatMessage>
    ): String {
        fun charTokEst(s: String): Int = maxOf(1, (s.length + 3) / 4)
        fun fmt(n: Int, est: Boolean): String = if (est) "~$n" else n.toString()
        val promptChars = messages.joinToString("\n") { it.content }
        val promptN = completion.promptTokens ?: charTokEst(promptChars)
        val promptEst = completion.promptTokens == null
        val compN = completion.completionTokens ?: charTokEst(completion.reply)
        val compEst = completion.completionTokens == null
        return "Sent ${fmt(promptN, promptEst)} tok · Generated ${fmt(compN, compEst)} tok"
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
            val completion = try {
                LocalLlmHttpClient.chat(port, token, messages)
            } catch (e: LocalLlmHttpClient.LocalLlmHttpException) {
                notifyDesktop(
                    PluginReportKind.CHAT_FAILED,
                    "HTTP ${e.status}",
                    mapOf("project" to project.name, "httpStatus" to e.status)
                )
                onLog("HTTP ${e.status}: ${e.body.take(800)}\n\n")
                ApplicationManager.getApplication().invokeLater { refreshConnection() }
                endSendTurn(false)
                return
            } catch (e: IOException) {
                notifyDesktop(
                    PluginReportKind.CHAT_FAILED,
                    e.message?.take(200),
                    mapOf("project" to project.name, "reason" to "io")
                )
                onLog(
                    "Cannot reach Local LLM Desktop at 127.0.0.1:$port — ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                        "Check the status strip (GET /health). Enable IDE integration in the desktop app.\n\n"
                )
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
                    onLog(
                        "Cannot reach Local LLM Desktop at 127.0.0.1:$port — ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                            "Check the status strip.\n\n"
                    )
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

                    if (payloadOnly != null) {
                        onLog("$assistantRecorded\n\n")
                    } else {
                        onLog("Model:\n$assistantRecorded\n\n")
                    }
                    onLog("${formatTokenUsageLine(completion, messages)}\n\n")
                    val meta = mutableMapOf<String, Any?>(
                        "project" to project.name,
                        "attachments" to attachmentCount,
                        "includeGraph" to includeGraph,
                        "clarificationRounds" to round
                    )
                    completion.promptTokens?.let { meta["promptTokens"] = it }
                    completion.completionTokens?.let { meta["completionTokens"] = it }
                    notifyDesktop(PluginReportKind.CHAT_COMPLETED, project.name, meta)
                    offerApplyStructuredEdits(assistantRecorded, referencedFiles) { endSendTurn(true) }
                    return
                }
                is ClarifyResponseParser.Parsed.NeedsClarification -> {
                    val latch = CountDownLatch(1)
                    var answerLines: List<String>? = null
                    ApplicationManager.getApplication().invokeLater {
                        try {
                            onLog(ClarifyResponseParser.userFacingClarifyText(parsed.questions))
                            onLog("${formatTokenUsageLine(completion, messages)}\n\n")
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
                        onLog("(Cancelled — no clarification provided.)\n\n")
                        endSendTurn(false)
                        return
                    }
                    messages.add(LocalLlmHttpClient.ChatMessage("assistant", completion.reply))
                    messages.add(LocalLlmHttpClient.ChatMessage("user", "My clarifications:\n${lines.joinToString("\n")}"))
                    round++
                }
            }
        }
        notifyDesktop(PluginReportKind.CHAT_FAILED, "Max clarification rounds", mapOf("project" to project.name))
        onLog("Model: (max clarification rounds reached — try a more specific prompt.)\n\n")
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
            appendTranscript = { line -> if (!project.isDisposed) transcript.append(line) },
            appendTranscriptSection = { title, body -> if (!project.isDisposed) transcript.appendSection(title, body) },
            notifyDesktop = { kind, message, meta -> notifyDesktop(kind, message, meta) },
            onComplete = onDone
        )
    }
}
