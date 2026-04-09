package com.localllm.intellij

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Opens the Local LLM tool window. If the editor has a selection, it is copied into the prompt.
 */
class AskLocalLlmAction : AnAction() {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR)
        val selected = editor?.selectionModel?.selectedText?.trim().orEmpty()

        val service = LocalLlmBridgeService.get(project)
        if (selected.isNotEmpty()) {
            service.pendingUserPrompt = selected
        }

        val tw = ToolWindowManager.getInstance(project).getToolWindow("LocalLLM")
        tw?.activate {
            ApplicationManager.getApplication().invokeLater {
                val panel = tw.contentManager.getContent(0)?.component as? LocalLlmToolWindowPanel
                panel?.applyPendingFromService()
            }
        }
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = e.project != null
    }
}
