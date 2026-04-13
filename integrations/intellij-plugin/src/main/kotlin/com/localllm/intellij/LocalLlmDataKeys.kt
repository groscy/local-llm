package com.localllm.intellij

import com.intellij.openapi.actionSystem.DataKey

object LocalLlmDataKeys {
    val TOOL_WINDOW_PANEL: DataKey<LocalLlmToolWindowPanel> =
        DataKey.create("com.localllm.intellij.LocalLlmToolWindowPanel")
}
