package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.DumbAwareAction

internal object LocalLlmToolWindowActions {

    fun createToolbarGroup(): DefaultActionGroup {
        val g = DefaultActionGroup()
        g.add(LocalLlmSendAction())
        g.add(LocalLlmResendAction())
        g.add(LocalLlmClearConversationAction())
        g.addSeparator()
        g.add(LocalLlmRefreshBridgeAction())
        g.add(LocalLlmVocabularyAction())
        g.addSeparator()
        g.add(LocalLlmOpenPluginSettingsAction())
        return g
    }
}

private fun toolWindowPanel(e: AnActionEvent): LocalLlmToolWindowPanel? =
    e.getData(LocalLlmDataKeys.TOOL_WINDOW_PANEL)
        ?: e.project?.let { LocalLlmBridgeService.get(it).toolWindowPanelOrNull() }

private class LocalLlmSendAction : DumbAwareAction(
    "Send",
    "Send message to the local model via the desktop bridge",
    AllIcons.Actions.Execute
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val p = toolWindowPanel(e)
        e.presentation.isEnabled = p != null && !p.isSending
    }

    override fun actionPerformed(e: AnActionEvent) {
        toolWindowPanel(e)?.sendToModel()
    }
}

private class LocalLlmClearConversationAction : DumbAwareAction(
    "Clear conversation",
    "Clear transcript and in-tool-window chat history for the next messages",
    AllIcons.General.Remove
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val p = toolWindowPanel(e)
        e.presentation.isEnabled = p != null && !p.isSending
    }

    override fun actionPerformed(e: AnActionEvent) {
        toolWindowPanel(e)?.clearConversation()
    }
}

private class LocalLlmResendAction : DumbAwareAction(
    "Resend last",
    "Resend the last message (same prompt and attachments)",
    AllIcons.Actions.Rerun
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val p = toolWindowPanel(e)
        e.presentation.isEnabled = p != null && !p.isSending && p.canResend()
        e.presentation.isVisible = p?.canResend() == true
    }

    override fun actionPerformed(e: AnActionEvent) {
        toolWindowPanel(e)?.resendLastMessage()
    }
}

private class LocalLlmRefreshBridgeAction : DumbAwareAction(
    "Refresh connection",
    "Ping Local LLM Desktop (GET /health and runtime status)",
    AllIcons.Actions.Refresh
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = toolWindowPanel(e) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        toolWindowPanel(e)?.refreshConnection()
    }
}

private class LocalLlmVocabularyAction : DumbAwareAction(
    "Domain vocabulary",
    "Generate domain vocabulary from project sources",
    AllIcons.Actions.Preview
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val p = toolWindowPanel(e)
        e.presentation.isEnabled = p != null && !p.isSending
    }

    override fun actionPerformed(e: AnActionEvent) {
        toolWindowPanel(e)?.generateDomainVocabulary()
    }
}

private class LocalLlmOpenPluginSettingsAction : DumbAwareAction(
    "Plugin settings",
    "Open Settings → Tools → Local LLM Desktop",
    AllIcons.General.Settings
) {
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        ShowSettingsUtil.getInstance().showSettingsDialog(project, LocalLlmConfigurable::class.java, null)
    }
}
