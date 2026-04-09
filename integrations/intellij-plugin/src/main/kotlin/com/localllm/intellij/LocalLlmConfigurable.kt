package com.localllm.intellij

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent

class LocalLlmConfigurable : Configurable {
    private val portField = JBTextField()
    private val tokenField = JBTextField()
    private var root: JComponent? = null

    override fun getDisplayName(): String = "Local LLM Desktop"

    override fun createComponent(): JComponent {
        root = FormBuilder.createFormBuilder()
            .addLabeledComponent("Bridge port (same as desktop app):", portField)
            .addLabeledComponent("Bearer token (optional):", tokenField)
            .panel
        reset()
        return root!!
    }

    override fun isModified(): Boolean {
        val p = PropertiesComponent.getInstance()
        return portField.text != p.getValue("localLlm.integrationPort", "17373") ||
            tokenField.text != (p.getValue("localLlm.integrationToken") ?: "")
    }

    override fun apply() {
        val p = PropertiesComponent.getInstance()
        p.setValue("localLlm.integrationPort", portField.text.ifBlank { "17373" })
        p.setValue("localLlm.integrationToken", tokenField.text)
    }

    override fun reset() {
        val p = PropertiesComponent.getInstance()
        portField.text = p.getValue("localLlm.integrationPort", "17373")
        tokenField.text = p.getValue("localLlm.integrationToken") ?: ""
    }

    override fun disposeUIResources() {
        root = null
    }
}
