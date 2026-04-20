package com.localllm.intellij

import com.intellij.ide.util.PropertiesComponent

/** Persisted IDE integration settings and tool window UX (see [LocalLlmConfigurable]). */
object LocalLlmIntegrationProperties {

    private const val PORT = "localLlm.integrationPort"
    private const val TOKEN = "localLlm.integrationToken"
    private const val SPLIT_RATIO = "localLlm.toolWindow.splitRatio"
    private const val ADVANCED_EXPANDED = "localLlm.advancedOptionsExpanded"
    private const val CONFIRM_BEFORE_APPLY = "localLlm.confirmBeforeFileApply"

    fun integrationPort(): Int {
        val props = PropertiesComponent.getInstance()
        return props.getValue(PORT)?.toIntOrNull()?.coerceIn(1024, 65535) ?: 17373
    }

    fun integrationToken(): String =
        PropertiesComponent.getInstance().getValue(TOKEN) ?: ""

    fun splitRatio(default: Float = 0.42f): Float {
        val v = PropertiesComponent.getInstance().getValue(SPLIT_RATIO)?.toFloatOrNull()
        return v?.coerceIn(0.15f, 0.85f) ?: default
    }

    fun setSplitRatio(ratio: Float) {
        PropertiesComponent.getInstance().setValue(SPLIT_RATIO, ratio.coerceIn(0.15f, 0.85f).toString())
    }

    fun advancedOptionsExpanded(default: Boolean = true): Boolean =
        PropertiesComponent.getInstance().getBoolean(ADVANCED_EXPANDED, default)

    fun setAdvancedOptionsExpanded(value: Boolean) {
        PropertiesComponent.getInstance().setValue(ADVANCED_EXPANDED, value, true)
    }

    /** When true, chat and agent runs show a confirmation dialog before writing parsed file edits. */
    fun confirmBeforeFileApply(): Boolean =
        PropertiesComponent.getInstance().getBoolean(CONFIRM_BEFORE_APPLY, false)

    fun setConfirmBeforeFileApply(value: Boolean) {
        PropertiesComponent.getInstance().setValue(CONFIRM_BEFORE_APPLY, value, false)
    }
}
