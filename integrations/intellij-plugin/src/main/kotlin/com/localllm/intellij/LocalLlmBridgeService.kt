package com.localllm.intellij

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

@Service(Service.Level.PROJECT)
class LocalLlmBridgeService {
    /** Consumed by [LocalLlmToolWindowPanel.applyPendingFromService] when the tool window opens. */
    @Volatile
    var pendingUserPrompt: String? = null

    companion object {
        fun get(project: Project): LocalLlmBridgeService =
            project.getService(LocalLlmBridgeService::class.java)
    }
}
