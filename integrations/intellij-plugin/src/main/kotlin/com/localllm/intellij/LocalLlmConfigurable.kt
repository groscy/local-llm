package com.localllm.intellij

import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import com.intellij.util.ui.JBUI
import javax.swing.JButton
import javax.swing.JCheckBox
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

class LocalLlmConfigurable : Configurable {
    private val portField = JBTextField()
    private val tokenField = JBTextField()
    private val inlineCompletionCheckbox = JCheckBox("Enable gray inline completion from local model (typing + Tab-trigger)")
    private val testButton = JButton("Test connection").apply {
        toolTipText = "GET /health on 127.0.0.1 and, if OK, GET /v1/runtime/status (uses fields above; Apply not required)"
    }
    private var root: JComponent? = null

    override fun getDisplayName(): String = "Local LLM Desktop"

    override fun createComponent(): JComponent {
        val help = JBLabel(
            "<html><body style=\"width:360px;\">" +
                "In <b>Local LLM Desktop</b>, open <b>More → Settings → IDE integration (localhost)</b>, " +
                "enable the HTTP bridge, and start a model from <b>Run</b>. " +
                "The bridge listens on <code>127.0.0.1</code> only; optional bearer token must match here and in the app." +
                "</body></html>"
        )

        testButton.addActionListener { runConnectionTest() }

        val form = FormBuilder.createFormBuilder()
            .addComponent(help)
            .addVerticalGap(8)
            .addLabeledComponent("Bridge port (same as desktop app):", portField)
            .addLabeledComponent("Bearer token (optional):", tokenField)
            .addSeparator()
            .addComponent(testButton)
            .addVerticalGap(8)
            .addComponent(inlineCompletionCheckbox)
            .panel
        form.border = JBUI.Borders.empty(0, 0, 8, 0)

        root = JBScrollPane(form).apply {
            border = null
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        }
        reset()
        return root!!
    }

    private fun runConnectionTest() {
        val port = portField.text.trim().toIntOrNull()?.coerceIn(1024, 65535) ?: 17373
        val token = tokenField.text
        testButton.isEnabled = false
        ApplicationManager.getApplication().executeOnPooledThread {
            val health = LocalLlmHttpClient.fetchHealth(port)
            val runtime = if (health.reachable && health.httpStatus == 200) {
                LocalLlmHttpClient.fetchRuntimeStatus(port, token)
            } else {
                null
            }
            ApplicationManager.getApplication().invokeLater {
                testButton.isEnabled = true
                val text = buildString {
                    appendLine("127.0.0.1:$port")
                    appendLine()
                    when {
                        !health.reachable ->
                            append("Unreachable: ${health.errorHint ?: "no response"}")
                        health.httpStatus != 200 ->
                            append("GET /health → HTTP ${health.httpStatus}: ${health.errorHint ?: ""}")
                        health.runtimeRunning != true ->
                            append("Bridge OK; runtime not running (start a model in the desktop app).")
                        else ->
                            append("Bridge OK; runtime running (${health.runtimeKind ?: "unknown"}).")
                    }
                    if (runtime != null) {
                        appendLine()
                        appendLine()
                        when (runtime.httpStatus) {
                            200 -> {
                                append("GET /v1/runtime/status → OK")
                                runtime.modelPath?.let { appendLine(); append("modelPath: $it") }
                                runtime.endpoint?.let { appendLine(); append("endpoint: $it") }
                            }
                            401 -> append("GET /v1/runtime/status → 401 Unauthorized (check bearer token).")
                            0 -> append("Runtime status: ${runtime.errorHint ?: "request failed"}")
                            else -> append("GET /v1/runtime/status → HTTP ${runtime.httpStatus}: ${runtime.errorHint ?: ""}")
                        }
                    }
                }
                Messages.showInfoMessage(root, text.trimEnd(), "Local LLM Desktop — connection test")
            }
        }
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
