package com.localllm.intellij

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

class LocalLlmConfigurable : Configurable {
    private val portField = JBTextField()
    private val tokenField = JBTextField()
    private val inlineCompletionCheckbox = JCheckBox("Enable gray inline completion from local model (typing + Tab-trigger)")
    private var root: JComponent? = null

    override fun getDisplayName(): String = "Local LLM Desktop"

    override fun createComponent(): JComponent {
        val form = FormBuilder.createFormBuilder()
            .addLabeledComponent("Bridge port (same as desktop app):", portField)
            .addLabeledComponent("Bearer token (optional):", tokenField)
            .addComponent(inlineCompletionCheckbox)
            .panel
        root = JBScrollPane(form).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
        reset()
        return root!!
    }

    override fun isModified(): Boolean {
        val p = PropertiesComponent.getInstance()
        return portField.text != p.getValue("localLlm.integrationPort", "17373") ||
            tokenField.text != (p.getValue("localLlm.integrationToken") ?: "") ||
            inlineCompletionCheckbox.isSelected != p.getBoolean(LocalLlmInlineCompletionProvider.INLINE_ENABLED_KEY, true)
    }

    override fun apply() {
        val p = PropertiesComponent.getInstance()
        p.setValue("localLlm.integrationPort", portField.text.ifBlank { "17373" })
        p.setValue("localLlm.integrationToken", tokenField.text)
        p.setValue(LocalLlmInlineCompletionProvider.INLINE_ENABLED_KEY, inlineCompletionCheckbox.isSelected, true)
    }

    override fun reset() {
        val p = PropertiesComponent.getInstance()
        portField.text = p.getValue("localLlm.integrationPort", "17373")
        tokenField.text = p.getValue("localLlm.integrationToken") ?: ""
        inlineCompletionCheckbox.isSelected = p.getBoolean(LocalLlmInlineCompletionProvider.INLINE_ENABLED_KEY, true)
    }

    override fun disposeUIResources() {
        root = null
    }
}
