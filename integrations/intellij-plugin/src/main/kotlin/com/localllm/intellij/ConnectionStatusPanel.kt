package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.EmptyIcon
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Font
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants
import javax.swing.Timer

/**
 * Compact bridge/runtime status with optional detail checklist and slower polling when disconnected.
 */
class ConnectionStatusPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {

    private enum class StepState { WAITING, PENDING, OK, FAIL }

    private val detailsInitiallyExpanded = LocalLlmIntegrationProperties.connectionDetailsExpanded()

    private val summaryLabel = JLabel().apply {
        font = JBFont.label().deriveFont(Font.BOLD)
        iconTextGap = 8
    }

    private val runtimeHintLabel = JLabel().apply {
        font = JBFont.label().deriveFont(JBFont.label().size2D - 1f)
        foreground = LocalLlmUiTheme.accentLabelForeground()
    }

    private val detailsToggle = JBCheckBox("Show connection details").apply {
        font = JBFont.label().deriveFont(JBFont.label().size2D - 1f)
        isOpaque = false
        isSelected = detailsInitiallyExpanded
        addActionListener {
            LocalLlmIntegrationProperties.setConnectionDetailsExpanded(isSelected)
            detailsHost.isVisible = isSelected
            revalidate()
        }
    }

    private val stepPlaceholder = EmptyIcon.create(JBUIScale.scale(16))
    private val step1Icon = JLabel()
    private val step1Text = JLabel().apply { font = JBFont.label() }
    private val step2Icon = JLabel()
    private val step2Text = JLabel().apply { font = JBFont.label() }
    private val step3Icon = JLabel()
    private val step3Text = JLabel().apply { font = JBFont.label() }

    private val detailText = JBTextArea(2, 24).apply {
        isEditable = false
        isFocusable = false
        lineWrap = true
        wrapStyleWord = true
        font = JBFont.label()
        isOpaque = true
        background = LocalLlmUiTheme.editorLikeSurface()
        border = JBUI.Borders.empty(4, 0, 0, 0)
        tabSize = 2
    }

    private val detailsPanel = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        border = JBUI.Borders.empty(4, 0, 0, 0)
        add(stepRow(step1Icon, step1Text))
        add(Box.createVerticalStrut(JBUIScale.scale(2)))
        add(stepRow(step2Icon, step2Text))
        add(Box.createVerticalStrut(JBUIScale.scale(2)))
        add(stepRow(step3Icon, step3Text))
        add(detailText)
    }

    private val detailsHost = JPanel(BorderLayout()).apply {
        isOpaque = false
        add(detailsPanel, BorderLayout.NORTH)
        isVisible = detailsInitiallyExpanded
    }

    private val detailsScroll = JBScrollPane(
        JPanel(BorderLayout()).apply {
            isOpaque = false
            add(detailsHost, BorderLayout.NORTH)
        }
    ).apply {
        border = JBUI.Borders.empty()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        minimumSize = Dimension(JBUIScale.scale(64), JBUIScale.scale(48))
        preferredSize = Dimension(JBUIScale.scale(220), JBUIScale.scale(if (detailsInitiallyExpanded) 100 else 1))
    }

    val refreshButton = JButton("Refresh").apply {
        font = JBFont.label()
        toolTipText = "Ping Local LLM Desktop (GET /health, then GET /v1/runtime/status when healthy)"
    }

    @Volatile
    private var disposed = false

    private val timer = Timer(12_000) { refreshNow() }

    init {
        isOpaque = false

        val north = JPanel(GridBagLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(8, 10, 4, 10)
            val c = GridBagConstraints().apply {
                gridx = 0
                weightx = 1.0
                fill = GridBagConstraints.HORIZONTAL
                anchor = GridBagConstraints.WEST
            }
            c.gridy = 0
            add(summaryLabel, c)
            c.gridy = 1
            add(runtimeHintLabel, c)
            c.gridy = 2
            add(detailsToggle, c)
        }

        val centerWrap = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(0, 10, 6, 10)
            add(detailsScroll, BorderLayout.CENTER)
        }

        val east = JPanel(FlowLayout(FlowLayout.RIGHT, JBUIScale.scale(6), 0)).apply {
            isOpaque = false
            border = JBUI.Borders.empty(6, 0, 6, 10)
            add(refreshButton)
        }

        add(north, BorderLayout.NORTH)
        add(centerWrap, BorderLayout.CENTER)
        add(east, BorderLayout.EAST)

        refreshButton.addActionListener { refreshNow() }
        timer.isRepeats = true
        timer.start()
        ApplicationManager.getApplication().invokeLater { refreshNow() }
    }

    private fun stepRow(icon: JLabel, text: JLabel): JPanel =
        JPanel(FlowLayout(FlowLayout.LEFT, JBUIScale.scale(6), JBUIScale.scale(2))).apply {
            isOpaque = false
            icon.preferredSize = Dimension(JBUIScale.scale(20), JBUIScale.scale(18))
            icon.minimumSize = icon.preferredSize
            add(icon)
            add(text)
        }

    private fun applyStep(icon: JLabel, text: JLabel, state: StepState, iconTooltip: String?) {
        icon.icon = when (state) {
            StepState.WAITING -> stepPlaceholder
            StepState.PENDING -> AllIcons.Process.Step_1
            StepState.OK -> AllIcons.General.GreenCheckmark
            StepState.FAIL -> AllIcons.General.Error
        }
        icon.toolTipText = iconTooltip
        text.foreground = when (state) {
            StepState.WAITING -> JBColor(Color(0x8E8E8E), Color(0x7A7A7A))
            StepState.PENDING -> JBColor(Color(0x303030), Color(0xBBBBBB))
            StepState.OK -> JBColor(Color(0x1B5E20), Color(0xC8E6C9))
            StepState.FAIL -> JBColor(Color(0xB71C1C), Color(0xFF8A80))
        }
    }

    private fun setCheckingUi(port: Int) {
        val host = "127.0.0.1:$port"
        summaryLabel.icon = AllIcons.Process.Step_1
        summaryLabel.text = "Checking connection…"
        summaryLabel.foreground = JBColor(Color(0x303030), Color(0xBBBBBB))
        runtimeHintLabel.text = " "
        step1Text.text = "Reach integration server ($host)"
        step2Text.text = "GET /health returns HTTP 200"
        step3Text.text = "Model runtime is running"
        applyStep(step1Icon, step1Text, StepState.PENDING, null)
        applyStep(step2Icon, step2Text, StepState.WAITING, null)
        applyStep(step3Icon, step3Text, StepState.WAITING, null)
        detailText.foreground = JBColor(Color(90, 90, 90), Color(180, 180, 180))
        detailText.text = "Checking…"
        detailText.caretPosition = 0
    }

    private fun applyResult(
        health: LocalLlmHttpClient.BridgeHealth,
        runtime: LocalLlmHttpClient.RuntimeStatus?,
        port: Int
    ) {
        val host = "127.0.0.1:$port"
        step1Text.text = "Reach integration server ($host)"
        step2Text.text = "GET /health returns HTTP 200"
        val kind = health.runtimeKind?.ifBlank { null }
        step3Text.text =
            if (kind != null) "Model runtime is running ($kind)" else "Model runtime is running"

        var modelLine: String? = null
        if (runtime != null && runtime.httpStatus == 200) {
            val mp = runtime.modelPath?.ifBlank { null }
            val ep = runtime.endpoint?.ifBlank { null }
            modelLine = when {
                mp != null && ep != null -> "Model: $mp · $ep"
                mp != null -> "Model: $mp"
                ep != null -> "Endpoint: $ep"
                else -> null
            }
        } else if (runtime != null && runtime.httpStatus == 401) {
            modelLine = "Runtime status: unauthorized (check bearer token in plugin settings)"
        } else if (runtime != null && runtime.httpStatus != 200 && runtime.httpStatus != 0) {
            modelLine = runtime.errorHint?.let { "Runtime status: $it" }
        }

        val bridgeOk = health.reachable && health.httpStatus == 200

        when {
            !health.reachable -> {
                summaryLabel.icon = AllIcons.General.Error
                summaryLabel.text = "Disconnected · $host"
                summaryLabel.foreground = JBColor(Color(0xB71C1C), Color(0xFF8A80))
                runtimeHintLabel.text = modelLine ?: " "
                applyStep(step1Icon, step1Text, StepState.FAIL, "No TCP/HTTP response")
                applyStep(step2Icon, step2Text, StepState.WAITING, null)
                applyStep(step3Icon, step3Text, StepState.WAITING, null)
                val detail = health.errorHint?.take(280) ?: "Connection refused or timed out"
                detailText.foreground = JBColor(Color(0xB71C1C), Color(0xFF8A80))
                detailText.text =
                    "$detail\nEnable IDE integration in Local LLM Desktop → Settings and keep the app running."
            }
            health.httpStatus != 200 -> {
                summaryLabel.icon = AllIcons.General.Warning
                summaryLabel.text = "Bridge error · HTTP ${health.httpStatus}"
                summaryLabel.foreground = JBColor(Color(0xE65100), Color(0xFFCC80))
                runtimeHintLabel.text = modelLine ?: " "
                applyStep(step1Icon, step1Text, StepState.OK, null)
                applyStep(step2Icon, step2Text, StepState.FAIL, "Non-200 response")
                applyStep(step3Icon, step3Text, StepState.WAITING, null)
                detailText.foreground = JBColor(Color(0xE65100), Color(0xFFCC80))
                detailText.text =
                    "Bridge responded with HTTP ${health.httpStatus} — $host\n${health.errorHint ?: ""}".trimEnd()
            }
            health.runtimeRunning == true -> {
                summaryLabel.icon = AllIcons.General.GreenCheckmark
                summaryLabel.text = "Ready · ${kind ?: "runtime on"} · $host"
                summaryLabel.foreground = JBColor(Color(0x1B5E20), Color(0xC8E6C9))
                runtimeHintLabel.text = modelLine ?: " "
                applyStep(step1Icon, step1Text, StepState.OK, null)
                applyStep(step2Icon, step2Text, StepState.OK, null)
                applyStep(step3Icon, step3Text, StepState.OK, null)
                detailText.foreground = JBColor(Color(0x1B5E20), Color(0xA5D6A7))
                detailText.text = "Chat requests use the desktop runtime."
            }
            else -> {
                summaryLabel.icon = AllIcons.General.Warning
                summaryLabel.text = "Bridge OK · model not running · $host"
                summaryLabel.foreground = JBColor(Color(0x6A1B9A), Color(0xCE93D8))
                runtimeHintLabel.text = modelLine ?: " "
                applyStep(step1Icon, step1Text, StepState.OK, null)
                applyStep(step2Icon, step2Text, StepState.OK, null)
                applyStep(step3Icon, step3Text, StepState.FAIL, "Runtime not started")
                detailText.foreground = JBColor(Color(0x6A1B9A), Color(0xCE93D8))
                detailText.text =
                    "Bridge is up but no model is running. Open Run in Local LLM Desktop and start your model."
            }
        }
        detailText.caretPosition = 0
        timer.delay = if (bridgeOk) 12_000 else 30_000
    }

    fun refreshNow() {
        if (disposed || project.isDisposed) return
        val port = LocalLlmIntegrationProperties.integrationPort()
        val token = LocalLlmIntegrationProperties.integrationToken()
        setCheckingUi(port)
        ApplicationManager.getApplication().executeOnPooledThread {
            val health = LocalLlmHttpClient.fetchHealth(port)
            val runtime = if (health.reachable && health.httpStatus == 200) {
                LocalLlmHttpClient.fetchRuntimeStatus(port, token)
            } else {
                null
            }
            ApplicationManager.getApplication().invokeLater(
                {
                    if (disposed || project.isDisposed) return@invokeLater
                    applyResult(health, runtime, port)
                },
                ModalityState.any()
            )
        }
    }

    override fun dispose() {
        disposed = true
        timer.stop()
    }
}
