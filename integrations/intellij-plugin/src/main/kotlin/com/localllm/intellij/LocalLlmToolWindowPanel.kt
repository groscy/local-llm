package com.localllm.intellij

import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.actionSystem.DataProvider
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.ui.JBSplitter
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

class LocalLlmToolWindowPanel(private val project: Project) :
    SimpleToolWindowPanel(false, true),
    DataProvider,
    Disposable {

    @Volatile
    var isSending: Boolean = false
        private set

    @Volatile
    private var lastSendSucceeded: Boolean = true

    private val connection = ConnectionStatusPanel(project)
    private val compose = LocalLlmComposePanel(project)
    private val transcript = LocalLlmTranscriptPanel(project)

    private val actionToolbar = ActionManager.getInstance().createActionToolbar(
        "ToolwindowToolbar",
        LocalLlmToolWindowActions.createToolbarGroup(),
        true
    )

    private val chatController: LocalLlmChatController

    init {
        chatController = LocalLlmChatController(
            project,
            compose,
            transcript,
            refreshConnection = { connection.refreshNow() },
            finishSendTurn = { success -> applyFinishSendTurn(success) }
        )

        LocalLlmBridgeService.get(project).registerToolWindowPanel(this)
        compose.setEnterToSend {
            if (!isSending) sendToModel()
        }

        val composeScroll = JBScrollPane(
            compose,
            ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
            ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
        ).apply {
            border = JBUI.Borders.empty()
            viewport.isOpaque = false
        }

        val composeCard = LocalLlmUiTheme.chatCardShell(composeScroll)
        val composeSlot = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(0, 0, LocalLlmUiTheme.sectionGap() / 2, 0)
            add(composeCard, BorderLayout.CENTER)
        }

        val transcriptCard = LocalLlmUiTheme.chatCardShell(transcript)

        val ratio = LocalLlmIntegrationProperties.splitRatio(0.42f)
        val split = OnePixelSplitter(true, ratio).apply {
            dividerWidth = com.intellij.ui.scale.JBUIScale.scale(1)
            firstComponent = composeSlot
            secondComponent = transcriptCard
            setHonorComponentsMinimumSize(true)
            addPropertyChangeListener(JBSplitter.PROP_PROPORTION) {
                LocalLlmIntegrationProperties.setSplitRatio(proportion)
            }
        }

        val connectionSlot = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(LocalLlmUiTheme.sectionGap(), 0, LocalLlmUiTheme.sectionGap(), 0)
            add(LocalLlmGlassCardPanel(connection), BorderLayout.CENTER)
        }

        val canvas = LocalLlmToolWindowCanvasPanel().apply {
            border = JBUI.Borders.empty(
                0,
                LocalLlmUiTheme.cardPadding(),
                LocalLlmUiTheme.cardPadding(),
                LocalLlmUiTheme.cardPadding()
            )
            add(connectionSlot, BorderLayout.NORTH)
            add(split, BorderLayout.CENTER)
        }

        setContent(canvas)

        actionToolbar.targetComponent = this
        actionToolbar.component.apply {
            isOpaque = true
            background = LocalLlmUiTheme.toolbarBackdrop()
        }
        setToolbar(actionToolbar.component)

        background = LocalLlmUiTheme.toolbarBackdrop()

        applyPendingFromService()
        ApplicationManager.getApplication().invokeLater { syncToolbarActions() }
    }

    @Suppress("DEPRECATION")
    private fun syncToolbarActions() {
        actionToolbar.updateActionsImmediately()
    }

    @Suppress("DEPRECATION")
    override fun dispose() {
        connection.dispose()
        if (!project.isDisposed) {
            LocalLlmBridgeService.get(project).unregisterToolWindowPanel(this)
        }
    }

    override fun getData(dataId: String): Any? = when {
        LocalLlmDataKeys.TOOL_WINDOW_PANEL.`is`(dataId) -> this
        CommonDataKeys.PROJECT.`is`(dataId) -> project
        else -> null
    }

    fun applyPendingFromService() {
        val pending = LocalLlmBridgeService.get(project).pendingUserPrompt
        if (!pending.isNullOrBlank()) {
            compose.promptArea.text = pending
            LocalLlmBridgeService.get(project).pendingUserPrompt = null
        }
    }

    fun refreshConnection() {
        connection.refreshNow()
    }

    fun sendToModel() {
        if (isSending || project.isDisposed) return
        isSending = true
        syncToolbarActions()
        chatController.sendToModel()
    }

    fun runAgent() {
        if (isSending || project.isDisposed) return
        val goal = compose.promptArea.text.trim()
        if (goal.isBlank()) {
            com.intellij.openapi.ui.Messages.showWarningDialog(
                project,
                "Enter an agent goal in the compose area (same as a chat prompt).",
                "Local LLM Agent"
            )
            return
        }
        isSending = true
        syncToolbarActions()
        val files = compose.snapshotFiles()
        val port = LocalLlmIntegrationProperties.integrationPort()
        val token = LocalLlmIntegrationProperties.integrationToken()
        transcript.appendSection("Agent goal", goal + if (files.isNotEmpty()) "\n\n— ${files.size} attachment(s) —" else "")
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Local LLM Agent", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    AgentOrchestrator.run(
                        project = project,
                        userGoal = goal,
                        referencedFiles = files,
                        applyStructuredEdits = compose.applyStructuredEdits.isSelected,
                        indicator = indicator,
                        port = port,
                        token = token,
                        onLog = { line ->
                            ApplicationManager.getApplication().invokeLater {
                                if (!project.isDisposed) transcript.append(line)
                            }
                        },
                        notifyDesktop = { kind, message, meta ->
                            LocalLlmPluginReports.postAsync(project, kind, message, meta)
                        },
                        onFinished = { success ->
                            ApplicationManager.getApplication().invokeLater {
                                applyFinishSendTurn(success)
                            }
                        }
                    )
                } catch (_: ProcessCanceledException) {
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) transcript.append("(Agent cancelled.)\n\n")
                        applyFinishSendTurn(false)
                    }
                }
            }
        })
    }

    fun resendLastMessage() {
        if (isSending || project.isDisposed) return
        isSending = true
        syncToolbarActions()
        chatController.resendLastMessage()
    }

    fun generateDomainVocabulary() {
        if (isSending) return
        chatController.generateDomainVocabulary()
    }

    fun clearConversation() {
        if (isSending) return
        chatController.clearConversation()
    }

    fun canResend(): Boolean =
        chatController.hasLastSendSnapshot() && !lastSendSucceeded

    private fun applyFinishSendTurn(success: Boolean) {
        if (project.isDisposed) return
        isSending = false
        lastSendSucceeded = success
        syncToolbarActions()
    }
}
