package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Font
import javax.swing.JLabel
import javax.swing.JPanel
import javax.swing.Timer

/** Bridge reachability only: Connected vs Not connected (GET /health HTTP 200). */
class ConnectionStatusPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {

    private val summaryLabel = JLabel().apply {
        font = JBFont.label().deriveFont(Font.PLAIN)
        iconTextGap = 6
        border = JBUI.Borders.empty(4, 8)
    }

    @Volatile
    private var disposed = false

    private val timer = Timer(12_000) { refreshNow() }

    init {
        isOpaque = false
        border = JBUI.Borders.empty()
        add(summaryLabel, BorderLayout.CENTER)
        timer.isRepeats = true
        timer.start()
        ApplicationManager.getApplication().invokeLater { refreshNow() }
    }

    private fun setCheckingUi() {
        summaryLabel.icon = AllIcons.Process.Step_1
        summaryLabel.text = "Bridge: checking"
        summaryLabel.foreground = JBColor(Color(0x303030), Color(0xBBBBBB))
    }

    private fun applyHealth(health: LocalLlmHttpClient.BridgeHealth, runtime: LocalLlmHttpClient.RuntimeStatus?) {
        val bridgeOk = health.reachable && health.httpStatus == 200
        if (bridgeOk) {
            summaryLabel.icon = AllIcons.General.GreenCheckmark
            val model = runtime
                ?.takeIf { it.httpStatus == 200 && it.running == true }
                ?.let { status ->
                    status.modelPath
                        ?.substringAfterLast('/')
                        ?.substringAfterLast('\\')
                        ?.ifBlank { null }
                        ?: status.endpoint
                        ?: status.kind
                }
            summaryLabel.text = if (model.isNullOrBlank()) {
                "Bridge: connected"
            } else {
                "Bridge: connected · model: $model"
            }
            summaryLabel.foreground = JBColor(Color(0x1B5E20), Color(0xC8E6C9))
        } else {
            summaryLabel.icon = AllIcons.General.Error
            val detail = health.errorHint
                ?.replace('\n', ' ')
                ?.replace(Regex("\\s+"), " ")
                ?.trim()
                ?.take(140)
            summaryLabel.text = if (detail.isNullOrBlank()) "Bridge: connection failed" else "Bridge: $detail"
            summaryLabel.foreground = JBColor(Color(0xB71C1C), Color(0xFF8A80))
        }
        timer.delay = if (bridgeOk) 12_000 else 30_000
    }

    fun refreshNow() {
        if (disposed || project.isDisposed) return
        val port = LocalLlmIntegrationProperties.integrationPort()
        val token = LocalLlmIntegrationProperties.integrationToken()
        setCheckingUi()
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
                    applyHealth(health, runtime)
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
