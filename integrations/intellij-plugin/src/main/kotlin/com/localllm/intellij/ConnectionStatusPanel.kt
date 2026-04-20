package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.FlowLayout
import java.awt.Font
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.Timer

/** Bridge reachability only: Connected vs Not connected (GET /health HTTP 200). */
class ConnectionStatusPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {

    private val summaryLabel = JLabel().apply {
        font = JBFont.label().deriveFont(Font.BOLD)
        iconTextGap = 8
    }

    val refreshButton = JButton("Refresh").apply {
        font = JBFont.label()
        toolTipText = "Ping the Local LLM Desktop bridge (GET /health)"
    }

    @Volatile
    private var disposed = false

    private val timer = Timer(12_000) { refreshNow() }

    init {
        isOpaque = false

        val west = JPanel(FlowLayout(FlowLayout.LEFT, JBUIScale.scale(8), 0)).apply {
            isOpaque = false
            border = JBUI.Borders.empty(8, 10, 8, 4)
            add(summaryLabel)
        }

        val east = JPanel(FlowLayout(FlowLayout.RIGHT, JBUIScale.scale(6), 0)).apply {
            isOpaque = false
            border = JBUI.Borders.empty(8, 4, 8, 10)
            add(refreshButton)
        }

        add(west, BorderLayout.WEST)
        add(east, BorderLayout.EAST)

        refreshButton.addActionListener { refreshNow() }
        timer.isRepeats = true
        timer.start()
        ApplicationManager.getApplication().invokeLater { refreshNow() }
    }

    private fun setCheckingUi() {
        summaryLabel.icon = AllIcons.Process.Step_1
        summaryLabel.text = "Checking…"
        summaryLabel.foreground = JBColor(Color(0x303030), Color(0xBBBBBB))
    }

    private fun applyHealth(health: LocalLlmHttpClient.BridgeHealth) {
        val bridgeOk = health.reachable && health.httpStatus == 200
        if (bridgeOk) {
            summaryLabel.icon = AllIcons.General.GreenCheckmark
            summaryLabel.text = "Connected"
            summaryLabel.foreground = JBColor(Color(0x1B5E20), Color(0xC8E6C9))
        } else {
            summaryLabel.icon = AllIcons.General.Error
            summaryLabel.text = "Not connected"
            summaryLabel.foreground = JBColor(Color(0xB71C1C), Color(0xFF8A80))
        }
        timer.delay = if (bridgeOk) 12_000 else 30_000
    }

    fun refreshNow() {
        if (disposed || project.isDisposed) return
        val port = LocalLlmIntegrationProperties.integrationPort()
        setCheckingUi()
        ApplicationManager.getApplication().executeOnPooledThread {
            val health = LocalLlmHttpClient.fetchHealth(port)
            ApplicationManager.getApplication().invokeLater(
                {
                    if (disposed || project.isDisposed) return@invokeLater
                    applyHealth(health)
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
