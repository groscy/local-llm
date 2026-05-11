package com.localllm.intellij

import com.intellij.ide.util.PropertiesComponent

/** Persisted IDE integration settings and tool window UX (see [LocalLlmConfigurable]). */
object LocalLlmIntegrationProperties {

    private const val PORT = "localLlm.integrationPort"
    private const val TOKEN = "localLlm.integrationToken"
    private const val ADVANCED_EXPANDED = "localLlm.advancedOptionsExpanded"

    fun integrationPort(): Int {
        val props = PropertiesComponent.getInstance()
        return props.getValue(PORT)?.toIntOrNull()?.coerceIn(1024, 65535) ?: 17373
    }

    fun integrationToken(): String =
        PropertiesComponent.getInstance().getValue(TOKEN) ?: ""

    fun advancedOptionsExpanded(default: Boolean = true): Boolean =
        PropertiesComponent.getInstance().getBoolean(ADVANCED_EXPANDED, default)

    fun setAdvancedOptionsExpanded(value: Boolean) {
        PropertiesComponent.getInstance().setValue(ADVANCED_EXPANDED, value, true)
    }

}
