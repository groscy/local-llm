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

        val connectionSlot = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(LocalLlmUiTheme.sectionGap() / 2, 0, LocalLlmUiTheme.sectionGap() / 2, 0)
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
            add(composeCard, BorderLayout.CENTER)
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
        val files = compose.snapshotFilesForSend()
        val port = LocalLlmIntegrationProperties.integrationPort()
        val token = LocalLlmIntegrationProperties.integrationToken()
        // Goal text remains in the compose area — inline output only marks the run.
        val agentLine = buildString {
            append("Agent")
            if (files.isNotEmpty()) append(" · ${files.size} attachment(s)")
        }
        compose.setProgress("$agentLine · starting…")
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
                                if (!project.isDisposed) compose.setProgress(line)
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
                        if (!project.isDisposed) compose.setProgress("Agent cancelled")
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
