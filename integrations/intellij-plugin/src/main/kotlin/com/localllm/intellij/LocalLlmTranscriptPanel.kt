package com.localllm.intellij

import com.intellij.notification.NotificationType
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.ui.HyperlinkLabel
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBPanelWithEmptyText
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.CardLayout
import java.awt.Component
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/** Conversation transcript with empty state and “Open plugin settings” shortcut. */
class LocalLlmTranscriptPanel(private val project: Project) : JPanel(BorderLayout()) {

    private val cards = CardLayout()
    private val cardHost = JPanel(cards)

    private val emptyPanel = JBPanelWithEmptyText().apply {
        isOpaque = false
        emptyText.text = "No messages yet"
        emptyText.appendSecondaryText(
            "\n\nEnable the HTTP bridge in Local LLM Desktop (Settings → IDE integration), start a model from Run, then match port and optional bearer token here: ",
            SimpleTextAttributes.GRAYED_ATTRIBUTES,
            null
        )
    }

    private val settingsLink = HyperlinkLabel("Local LLM Desktop plugin settings").apply {
        addHyperlinkListener {
            ShowSettingsUtil.getInstance().showSettingsDialog(project, LocalLlmConfigurable::class.java, null)
        }
    }

    private val desktopIdeSetupLink = HyperlinkLabel("IntelliJ bridge guide in the desktop app").apply {
        addHyperlinkListener {
            LocalLlmNotifications.notify(
                project,
                "IntelliJ bridge in Local LLM Desktop",
                "Open the Local LLM Desktop window. From Settings → Integrations, enable the bridge and review the checklist. In unpackaged (development) builds, open the Dev view for the full journey, paths, and Test bridge.",
                NotificationType.INFORMATION
            )
        }
    }

    private val linkRow = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        isOpaque = false
        border = JBUI.Borders.empty(0, 0, 8, 0)
        alignmentX = Component.LEFT_ALIGNMENT
        settingsLink.alignmentX = Component.LEFT_ALIGNMENT
        desktopIdeSetupLink.alignmentX = Component.LEFT_ALIGNMENT
        add(settingsLink)
        add(Box.createVerticalStrut(JBUI.scale(6)))
        add(desktopIdeSetupLink)
    }

    private val emptyWrap = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.empty(12, 8, 12, 8)
        add(emptyPanel, BorderLayout.NORTH)
        add(linkRow, BorderLayout.SOUTH)
    }

    private val logArea = JBTextArea(8, 36).apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        isOpaque = true
        background = LocalLlmUiTheme.editorLikeSurface()
        font = JBFont.label()
        border = JBUI.Borders.empty(8)
    }

    private val logScroll = JBScrollPane(logArea).apply {
        border = LocalLlmUiTheme.innerChromeBorder()
        horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
        verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
        viewport.isOpaque = true
        viewport.background = LocalLlmUiTheme.editorLikeSurface()
    }

    private val transcriptHeader = JPanel(BorderLayout()).apply {
        isOpaque = false
        border = JBUI.Borders.emptyBottom(6)
        add(
            JBLabel("Conversation").apply {
                foreground = LocalLlmUiTheme.accentLabelForeground()
            },
            BorderLayout.WEST
        )
    }

    private val transcriptBody = JPanel(BorderLayout()).apply {
        add(transcriptHeader, BorderLayout.NORTH)
        add(logScroll, BorderLayout.CENTER)
    }

    private var hasContent = false

    init {
        isOpaque = false
        cardHost.isOpaque = false
        cardHost.add(emptyWrap, "empty")
        cardHost.add(transcriptBody, "transcript")
        cards.show(cardHost, "empty")
        add(cardHost, BorderLayout.CENTER)
    }

    fun append(text: String) {
        if (!hasContent) {
            hasContent = true
            cards.show(cardHost, "transcript")
        }
        logArea.append(text)
        logArea.caretPosition = logArea.document.length
    }

    fun appendSection(title: String, body: String) {
        val rule = "────────────────────────────────"
        append("$rule\n")
        append("$title\n")
        append("$rule\n")
        append(body)
        if (!body.endsWith("\n")) append("\n")
        append("\n")
    }

    fun clearTranscript() {
        logArea.text = ""
        hasContent = false
        cards.show(cardHost, "empty")
    }
}
