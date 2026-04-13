package com.localllm.intellij

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import java.lang.ref.WeakReference

@Service(Service.Level.PROJECT)
class LocalLlmBridgeService {
    /** Consumed by [LocalLlmToolWindowPanel.applyPendingFromService] when the tool window opens. */
    @Volatile
    var pendingUserPrompt: String? = null

    private var toolWindowPanelRef: WeakReference<LocalLlmToolWindowPanel>? = null

    fun registerToolWindowPanel(panel: LocalLlmToolWindowPanel) {
        toolWindowPanelRef = WeakReference(panel)
    }

    fun unregisterToolWindowPanel(panel: LocalLlmToolWindowPanel) {
        if (toolWindowPanelRef?.get() === panel) {
            toolWindowPanelRef = null
        }
    }

    fun toolWindowPanelOrNull(): LocalLlmToolWindowPanel? = toolWindowPanelRef?.get()

    companion object {
        fun get(project: Project): LocalLlmBridgeService =
            project.getService(LocalLlmBridgeService::class.java)
    }
}
