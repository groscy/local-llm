package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.JBColor
import com.intellij.ui.OnePixelSplitter
import com.intellij.ui.SeparatorFactory
import com.intellij.ui.ToolbarDecorator
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Color
import java.awt.Component
import java.awt.Dimension
import java.awt.FlowLayout
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.DefaultListCellRenderer
import javax.swing.DefaultListModel
import javax.swing.JButton
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import javax.swing.ScrollPaneConstants
import javax.swing.Timer
import javax.swing.UIManager

class LocalLlmToolWindowPanel(private val project: Project) : JPanel(BorderLayout()), Disposable {

    private data class LastSendSnapshot(
        val promptText: String,
        val filePaths: List<String>,
        val includeGraph: Boolean
    )

    @Volatile
    private var connectionUiDisposed = false

    /** Captured when a send starts so we can restore prompt + attachments after a failure. */
    private var lastSendSnapshot: LastSendSnapshot? = null

    /** Status icon: checkmark when bridge + runtime OK, cross otherwise; text scrolls/wraps separately. */
    private val connectionIconLabel = JLabel().apply {
        border = JBUI.Borders.empty(6, 0, 6, JBUIScale.scale(8))
    }

    private val connectionStatusText = JBTextArea(2, 24).apply {
        isEditable = false
        isFocusable = false
        lineWrap = true
        wrapStyleWord = true
        font = JBFont.label()
        background = JBColor.PanelBackground
        border = JBUI.Borders.empty(6, 0, 6, JBUIScale.scale(4))
        tabSize = 2
    }

    private val refreshConnectionBtn = JButton("Refresh connection").apply {
        font = JBFont.label()
        toolTipText = "Ping Local LLM Desktop HTTP bridge (GET /health)"
    }

    /** Auto-refresh bridge / runtime status while the tool window exists. */
    private val connectionRefreshTimer = Timer(12_000) { refreshConnectionStatus() }

    private val fileModel = DefaultListModel<VirtualFile>()
    private val fileList = JBList(fileModel).apply {
        layoutOrientation = JList.HORIZONTAL_WRAP
        visibleRowCount = 1
        selectionMode = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION
        fixedCellHeight = JBUIScale.scale(22)
        cellRenderer = object : DefaultListCellRenderer() {
            override fun getListCellRendererComponent(
                list: JList<*>,
                value: Any?,
                index: Int,
                isSelected: Boolean,
                cellHasFocus: Boolean
            ): Component {
                super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus)
                if (value is VirtualFile) {
                    text = value.presentableName
                    toolTipText = value.path
                    icon = value.fileType.icon
                }
                return this
            }
        }
    }

    private val promptArea = JBTextArea(5, 36).apply {
        lineWrap = true
        wrapStyleWord = true
        font = JBFont.label().biggerOn(1f)
        border = JBUI.Borders.empty(8)
    }

    private val includeGraph = JBCheckBox("Include structural codebase graph (Java / Kotlin)", true).apply {
        border = JBUI.Borders.empty(0, 0, 0, JBUIScale.scale(4))
    }

    private val applyStructuredEdits = JBCheckBox("Apply file replacement blocks from replies (with confirm)", true).apply {
        border = JBUI.Borders.empty(JBUIScale.scale(4), 0, 0, JBUIScale.scale(4))
    }

    private val logArea = JBTextArea(12, 36).apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        background = JBColor.PanelBackground
        font = JBFont.label()
        border = JBUI.Borders.empty(8)
    }

    private val vocabularyBtn = JButton("Vocabulary…").apply {
        font = JBFont.label().biggerOn(0.5f)
        toolTipText = "Generate domain vocabulary from project sources (grouped by package domain) and attached file names"
    }

    private val sendBtn = JButton("Send").apply {
        font = JBFont.label().biggerOn(0.5f)
        isDefaultCapable = true
    }

    private val resendBtn = JButton(AllIcons.Actions.Refresh).apply {
        toolTipText = "Resend last message (same prompt and attachments)"
        accessibleContext.accessibleName = "Resend last message"
        isVisible = false
        isEnabled = false
        margin = JBUI.insets(2)
        preferredSize = Dimension(JBUIScale.scale(30), JBUIScale.scale(30))
        minimumSize = preferredSize
    }

    init {
        border = JBUI.Borders.empty(JBUIScale.scale(10), JBUIScale.scale(12))
        applyStructuredEdits.isSelected =
            PropertiesComponent.getInstance().getBoolean("localLlm.applyStructuredEdits", true)
        applyStructuredEdits.addActionListener {
            PropertiesComponent.getInstance().setValue(
                "localLlm.applyStructuredEdits",
                applyStructuredEdits.isSelected,
                true
            )
        }
        applyPendingFromService()

        val statusTextScroll = JBScrollPane(connectionStatusText).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            minimumSize = Dimension(JBUIScale.scale(64), JBUIScale.scale(44))
            preferredSize = Dimension(JBUIScale.scale(200), JBUIScale.scale(72))
        }
        val statusStrip = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.customLine(JBColor.border(), 1)
            background = JBColor.PanelBackground
            add(connectionIconLabel, BorderLayout.WEST)
            add(statusTextScroll, BorderLayout.CENTER)
            add(
                JPanel(FlowLayout(FlowLayout.RIGHT, JBUIScale.scale(6), 0)).apply {
                    isOpaque = false
                    add(refreshConnectionBtn)
                },
                BorderLayout.EAST
            )
        }
        refreshConnectionBtn.addActionListener { refreshConnectionStatus() }
        connectionRefreshTimer.isRepeats = true
        connectionRefreshTimer.start()
        ApplicationManager.getApplication().invokeLater { refreshConnectionStatus() }

        val fileToolbarPanel = ToolbarDecorator.createDecorator(fileList)
            .setAddAction {
                val descriptor = FileChooserDescriptorFactory.createMultipleFilesNoJarsDescriptor().apply {
                    title = "Attach code files"
                    description = "Files are appended to your prompt as labeled code blocks (text only)."
                    isShowFileSystemRoots = false
                }
                val chosen = FileChooser.chooseFiles(descriptor, this@LocalLlmToolWindowPanel, project, null)
                chosen.forEach { f ->
                    if (!f.isDirectory) addFileUnique(f)
                }
            }
            .addExtraAction(object : AnAction(
                "From editor",
                "Add the file from the active editor tab",
                AllIcons.Actions.Preview
            ) {
                override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
                override fun actionPerformed(e: AnActionEvent) {
                    val vfs = FileEditorManager.getInstance(project).selectedFiles
                    for (f in vfs) {
                        if (!f.isDirectory) addFileUnique(f)
                    }
                }

                override fun update(e: AnActionEvent) {
                    e.presentation.isEnabled = FileEditorManager.getInstance(project).selectedFiles.isNotEmpty()
                }
            })
            .addExtraAction(object : AnAction("Clear list", "Remove all attachments", AllIcons.Actions.GC) {
                override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT
                override fun actionPerformed(e: AnActionEvent) {
                    fileModel.clear()
                }
            })
            .createPanel()

        val promptScroll = JBScrollPane(promptArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            minimumSize = Dimension(JBUIScale.scale(100), JBUIScale.scale(64))
        }

        val promptBox = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.customLine(JBColor.border(), 1)
            background = JBColor.PanelBackground
            add(fileToolbarPanel, BorderLayout.NORTH)
            add(
                JPanel(BorderLayout()).apply {
                    border = JBUI.Borders.customLine(JBColor.border(), 0, 1, 0, 0)
                    isOpaque = false
                    add(promptScroll, BorderLayout.CENTER)
                },
                BorderLayout.CENTER
            )
        }

        val promptSection = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.emptyBottom(JBUIScale.scale(8))
            add(SeparatorFactory.createSeparator("Your message", null), BorderLayout.NORTH)
            add(promptBox, BorderLayout.CENTER)
        }

        val footer = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            alignmentX = Component.LEFT_ALIGNMENT
            val checks = JPanel().apply {
                layout = BoxLayout(this, BoxLayout.Y_AXIS)
                alignmentX = Component.LEFT_ALIGNMENT
                isOpaque = false
                add(includeGraph.apply { alignmentX = Component.LEFT_ALIGNMENT })
                add(Box.createVerticalStrut(JBUIScale.scale(2)))
                add(applyStructuredEdits.apply { alignmentX = Component.LEFT_ALIGNMENT })
            }
            add(checks)
            add(Box.createVerticalStrut(JBUIScale.scale(8)))
            val btnRow = JPanel(FlowLayout(FlowLayout.RIGHT, JBUIScale.scale(8), 0)).apply {
                isOpaque = false
                maximumSize = Dimension(Int.MAX_VALUE, Int.MAX_VALUE)
                add(vocabularyBtn)
                add(resendBtn)
                add(sendBtn)
            }
            add(btnRow)
        }

        val composeCard = JPanel(GridBagLayout()).apply {
            minimumSize = Dimension(JBUIScale.scale(200), JBUIScale.scale(120))
            val c = GridBagConstraints().apply {
                gridx = 0
                weightx = 1.0
                fill = GridBagConstraints.HORIZONTAL
                anchor = GridBagConstraints.NORTH
                insets = JBUI.insets(0, 0, 0, 0)
            }
            c.gridy = 0
            c.weighty = 1.0
            c.fill = GridBagConstraints.BOTH
            add(promptSection, c)
            c.gridy = 1
            c.weighty = 0.0
            c.fill = GridBagConstraints.HORIZONTAL
            c.insets = JBUI.insets(JBUIScale.scale(10), 0, 0, 0)
            add(footer, c)
        }

        val composeScroll = JBScrollPane(
            composeCard,
            ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED,
            ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
        ).apply {
            border = JBUI.Borders.empty()
            minimumSize = Dimension(JBUIScale.scale(200), JBUIScale.scale(120))
        }

        val logHeader = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.emptyBottom(JBUIScale.scale(6))
            add(SeparatorFactory.createSeparator("Conversation", null), BorderLayout.WEST)
        }
        val logScroll = JBScrollPane(logArea).apply {
            border = JBUI.Borders.customLine(JBColor.border(), 1)
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            minimumSize = Dimension(JBUIScale.scale(160), JBUIScale.scale(80))
        }
        val logWrap = JPanel(BorderLayout()).apply {
            minimumSize = Dimension(JBUIScale.scale(160), JBUIScale.scale(100))
            add(logHeader, BorderLayout.NORTH)
            add(logScroll, BorderLayout.CENTER)
        }

        val split = OnePixelSplitter(true, 0.42f).apply {
            dividerWidth = JBUIScale.scale(1)
            firstComponent = composeScroll
            secondComponent = logWrap
            setHonorComponentsMinimumSize(true)
        }
        minimumSize = Dimension(JBUIScale.scale(240), JBUIScale.scale(180))
        add(statusStrip, BorderLayout.NORTH)
        add(split, BorderLayout.CENTER)

        sendBtn.addActionListener { sendToModel() }
        resendBtn.addActionListener { resendLastMessage() }
        vocabularyBtn.addActionListener { generateDomainVocabulary() }

        background = UIManager.getColor("Panel.background") ?: JBColor.PanelBackground
        composeCard.isOpaque = false
        promptBox.isOpaque = true
        promptSection.isOpaque = false
        footer.isOpaque = false
        statusStrip.isOpaque = true
        setConnectionCheckingUi()
    }

    override fun dispose() {
        connectionUiDisposed = true
        connectionRefreshTimer.stop()
    }

    private fun integrationPort(): Int {
        val props = PropertiesComponent.getInstance()
        return props.getValue("localLlm.integrationPort")?.toIntOrNull()?.coerceIn(1024, 65535) ?: 17373
    }

    private fun setConnectionCheckingUi() {
        val port = integrationPort()
        connectionIconLabel.icon = AllIcons.Process.Step_1
        connectionStatusText.foreground = JBColor(Color(90, 90, 90), Color(180, 180, 180))
        connectionStatusText.text = "Checking 127.0.0.1:$port…"
        connectionStatusText.caretPosition = 0
    }

    private fun applyBridgeHealthUi(health: LocalLlmHttpClient.BridgeHealth, port: Int) {
        val host = "127.0.0.1:$port"
        when {
            !health.reachable -> {
                connectionIconLabel.icon = AllIcons.General.Error
                connectionStatusText.foreground = JBColor(Color(0xB71C1C), Color(0xFF8A80))
                val detail = health.errorHint?.take(180) ?: "Connection refused or timed out"
                connectionStatusText.text = buildString {
                    append("Disconnected — $host\n")
                    append(detail)
                    append("\nOpen Local LLM Desktop → Settings → enable IDE integration and keep the app running.")
                }
                connectionStatusText.caretPosition = 0
            }
            health.httpStatus != 200 -> {
                connectionIconLabel.icon = AllIcons.General.Error
                connectionStatusText.foreground = JBColor(Color(0xE65100), Color(0xFFCC80))
                connectionStatusText.text =
                    "Bridge responded with HTTP ${health.httpStatus} — $host\n${health.errorHint ?: ""}"
                connectionStatusText.caretPosition = 0
            }
            health.runtimeRunning == true -> {
                connectionIconLabel.icon = AllIcons.General.GreenCheckmark
                connectionStatusText.foreground = JBColor(Color(0x1B5E20), Color(0xA5D6A7))
                val kind = health.runtimeKind?.ifBlank { null } ?: "?"
                connectionStatusText.text = "Connected — $host · Model runtime running ($kind)"
                connectionStatusText.caretPosition = 0
            }
            else -> {
                connectionIconLabel.icon = AllIcons.General.Error
                connectionStatusText.foreground = JBColor(Color(0x6A1B9A), Color(0xCE93D8))
                connectionStatusText.text =
                    "Bridge OK — $host · Model runtime stopped — start Run in Local LLM Desktop"
                connectionStatusText.caretPosition = 0
            }
        }
    }

    private fun refreshConnectionStatus() {
        if (connectionUiDisposed || project.isDisposed) return
        setConnectionCheckingUi()
        val port = integrationPort()
        ApplicationManager.getApplication().executeOnPooledThread {
            val health = LocalLlmHttpClient.fetchHealth(port)
            ApplicationManager.getApplication().invokeLater(
                {
                    if (connectionUiDisposed || project.isDisposed) return@invokeLater
                    applyBridgeHealthUi(health, port)
                },
                ModalityState.any()
            )
        }
    }

    private fun addFileUnique(vf: VirtualFile) {
        for (i in 0 until fileModel.size()) {
            if (fileModel.getElementAt(i).path == vf.path) return
        }
        fileModel.addElement(vf)
    }

    fun applyPendingFromService() {
        val pending = LocalLlmBridgeService.get(project).pendingUserPrompt
        if (!pending.isNullOrBlank()) {
            promptArea.text = pending
            LocalLlmBridgeService.get(project).pendingUserPrompt = null
        }
    }

    private fun generateDomainVocabulary() {
        val attached = snapshotFiles()
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Domain vocabulary", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    indicator.text = "Scanning Java/Kotlin sources…"
                    val report = ApplicationManager.getApplication().runReadAction<DomainVocabularyCollector.VocabularyReport> {
                        DomainVocabularyCollector.collect(project, indicator, attached)
                    }
                    ApplicationManager.getApplication().invokeLater {
                        if (project.isDisposed) return@invokeLater
                        DomainVocabularyDialog(project, report.markdown).show()
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        if (!project.isDisposed) {
                            Messages.showErrorDialog(project, e.message ?: e.toString(), "Domain vocabulary")
                        }
                    }
                }
            }
        })
    }

    private fun snapshotFiles(): List<VirtualFile> {
        val out = ArrayList<VirtualFile>(fileModel.size())
        for (i in 0 until fileModel.size()) {
            out.add(fileModel.getElementAt(i))
        }
        return out
    }

    private fun appendLog(text: String) {
        logArea.append(text)
        logArea.caretPosition = logArea.document.length
    }

    private fun finishSendTurn(success: Boolean) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            sendBtn.isEnabled = true
            resendBtn.isEnabled = true
            resendBtn.isVisible = !success && lastSendSnapshot != null
        }
    }

    private fun resendLastMessage() {
        val snap = lastSendSnapshot ?: return
        promptArea.text = snap.promptText
        includeGraph.isSelected = snap.includeGraph
        fileModel.clear()
        val fs = LocalFileSystem.getInstance()
        for (p in snap.filePaths) {
            val vf = fs.findFileByPath(p)
            if (vf != null && !vf.isDirectory) addFileUnique(vf)
        }
        sendToModel()
    }

    private fun sendToModel() {
        val question = promptArea.text.trim()
        val files = snapshotFiles()
        if (question.isBlank() && files.isEmpty()) {
            Messages.showWarningDialog(
                project,
                "Enter a message and/or attach at least one file.",
                "Local LLM"
            )
            return
        }

        lastSendSnapshot = LastSendSnapshot(
            promptText = promptArea.text,
            filePaths = files.map { it.path },
            includeGraph = includeGraph.isSelected
        )

        val port = integrationPort()
        val token = PropertiesComponent.getInstance().getValue("localLlm.integrationToken") ?: ""

        val preview = buildString {
            if (question.isNotEmpty()) appendLine(question)
            if (files.isNotEmpty()) {
                appendLine()
                appendLine("— ${files.size} file(s) attached —")
            }
        }
        appendLog("You:\n${preview.trimEnd()}\n\n")

        sendBtn.isEnabled = false
        resendBtn.isEnabled = false
        resendBtn.isVisible = false

        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "Local LLM", true) {
            override fun run(indicator: ProgressIndicator) {
                try {
                    val basePrompt = if (question.isBlank()) {
                        "Respond to the attached files."
                    } else {
                        question
                    }
                    indicator.text = "Preparing message…"
                    val bundled = ApplicationManager.getApplication().runReadAction<PromptAttachmentBundler.Result> {
                        PromptAttachmentBundler.bundle(basePrompt, files, indicator)
                    }
                    if (bundled.summaryLines.isNotEmpty()) {
                        val summary = bundled.summaryLines.joinToString("\n") { "  · $it" }
                        ApplicationManager.getApplication().invokeLater {
                            appendLog("Attachments:\n$summary\n\n")
                        }
                    }

                    runChatWithOptionalClarify(
                        indicator = indicator,
                        port = port,
                        token = token,
                        userMessage = bundled.augmentedUserMessage,
                        includeGraph = includeGraph.isSelected,
                        onLog = { line ->
                            ApplicationManager.getApplication().invokeLater { appendLog(line) }
                        }
                    )
                } catch (_: ProcessCanceledException) {
                    ApplicationManager.getApplication().invokeLater {
                        appendLog("(Cancelled.)\n\n")
                        finishSendTurn(false)
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        val net = e is IOException || LocalLlmHttpClient.isConnectFailure(e)
                        if (net) {
                            appendLog(
                                "Connection error · 127.0.0.1:$port · ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                                    "See the status bar at the top of this tool window. Enable IDE integration in Local LLM Desktop.\n\n"
                            )
                            refreshConnectionStatus()
                        } else {
                            appendLog("Error: ${e.message ?: e}\n\n")
                            Messages.showErrorDialog(project, e.message ?: e.toString(), "Local LLM")
                        }
                        finishSendTurn(false)
                    }
                }
            }
        })
    }

    /** Same shape as the Electron chat footer: `Sent … tok · Generated … tok` (tilde when char-based estimate). */
    private fun formatTokenUsageLine(
        completion: LocalLlmHttpClient.ChatCompletion,
        messages: List<LocalLlmHttpClient.ChatMessage>
    ): String {
        fun charTokEst(s: String): Int = maxOf(1, (s.length + 3) / 4)
        fun fmt(n: Int, est: Boolean): String = if (est) "~$n" else n.toString()
        val promptChars = messages.joinToString("\n") { it.content }
        val promptN = completion.promptTokens ?: charTokEst(promptChars)
        val promptEst = completion.promptTokens == null
        val compN = completion.completionTokens ?: charTokEst(completion.reply)
        val compEst = completion.completionTokens == null
        return "Sent ${fmt(promptN, promptEst)} tok · Generated ${fmt(compN, compEst)} tok"
    }

    private fun runChatWithOptionalClarify(
        indicator: ProgressIndicator,
        port: Int,
        token: String,
        userMessage: String,
        includeGraph: Boolean,
        onLog: (String) -> Unit
    ) {
        val graphText = if (includeGraph) {
            indicator.text = "Building knowledge graph…"
            ApplicationManager.getApplication().runReadAction<String> {
                KnowledgeGraphCollector.collect(project, indicator)
            }
        } else {
            ""
        }

        val messages = mutableListOf(
            LocalLlmHttpClient.ChatMessage("system", LocalLlmSystemPrompts.build(graphText)),
            LocalLlmHttpClient.ChatMessage("user", userMessage)
        )

        var round = 0
        while (round < 3) {
            indicator.checkCanceled()
            indicator.text = "Waiting for local model…"
            val completion = try {
                LocalLlmHttpClient.chat(port, token, messages)
            } catch (e: LocalLlmHttpClient.LocalLlmHttpException) {
                onLog("HTTP ${e.status}: ${e.body.take(800)}\n\n")
                ApplicationManager.getApplication().invokeLater { refreshConnectionStatus() }
                finishSendTurn(false)
                return
            } catch (e: IOException) {
                onLog(
                    "Cannot reach Local LLM Desktop at 127.0.0.1:$port — ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                        "Check the connection strip above (GET /health). Enable IDE integration in the desktop app.\n\n"
                )
                ApplicationManager.getApplication().invokeLater { refreshConnectionStatus() }
                finishSendTurn(false)
                return
            } catch (e: Exception) {
                if (LocalLlmHttpClient.isConnectFailure(e)) {
                    onLog(
                        "Cannot reach Local LLM Desktop at 127.0.0.1:$port — ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                            "Check the connection strip above.\n\n"
                    )
                    ApplicationManager.getApplication().invokeLater { refreshConnectionStatus() }
                    finishSendTurn(false)
                    return
                }
                throw e
            }

            when (val parsed = ClarifyResponseParser.parse(completion.reply)) {
                is ClarifyResponseParser.Parsed.DirectAnswer -> {
                    onLog("Model:\n${parsed.text}\n\n")
                    onLog("${formatTokenUsageLine(completion, messages)}\n\n")
                    offerApplyStructuredEdits(parsed.text) { finishSendTurn(true) }
                    return
                }
                is ClarifyResponseParser.Parsed.NeedsClarification -> {
                    val latch = CountDownLatch(1)
                    var answers: String? = null
                    ApplicationManager.getApplication().invokeLater {
                        try {
                            onLog(ClarifyResponseParser.userFacingClarifyText(parsed.questions))
                            onLog("${formatTokenUsageLine(completion, messages)}\n\n")
                            val lines = mutableListOf<String>()
                            var cancelled = false
                            for (q in parsed.questions) {
                                val line = Messages.showInputDialog(
                                    project,
                                    q,
                                    "Local LLM — clarify",
                                    Messages.getQuestionIcon()
                                )
                                if (line == null) {
                                    cancelled = true
                                    break
                                }
                                lines.add(line.trim())
                            }
                            answers = if (cancelled) null else lines.joinToString("\n")
                        } finally {
                            latch.countDown()
                        }
                    }
                    if (!latch.await(15, TimeUnit.MINUTES)) {
                        onLog("(Timed out waiting for clarification.)\n\n")
                        finishSendTurn(false)
                        return
                    }
                    val clarificationText = answers
                    if (clarificationText.isNullOrBlank()) {
                        onLog("(Cancelled — no clarification provided.)\n\n")
                        finishSendTurn(false)
                        return
                    }
                    messages.add(LocalLlmHttpClient.ChatMessage("assistant", completion.reply))
                    messages.add(LocalLlmHttpClient.ChatMessage("user", "My clarifications:\n${clarificationText.trim()}"))
                    round++
                }
            }
        }
        onLog("Model: (max clarification rounds reached — try a more specific prompt.)\n\n")
        finishSendTurn(false)
    }

    /**
     * If the model reply contains <<<LOCAL_LLM_FILE>>> blocks and the user opted in, prompt and write files
     * under the project root (full replacement per file).
     */
    private fun offerApplyStructuredEdits(modelReply: String, onDone: () -> Unit) {
        if (!applyStructuredEdits.isSelected) {
            onDone()
            return
        }
        val blocks = StructuredApplyParser.parse(modelReply)
        if (blocks.isEmpty()) {
            onDone()
            return
        }
        ApplicationManager.getApplication().invokeLater {
            val msg = buildString {
                appendLine(
                    "The model returned ${blocks.size} file block(s). Each path is replaced entirely on disk (UTF-8). " +
                        "New directories are created if needed."
                )
                appendLine()
                for (b in blocks) {
                    appendLine("· ${b.path}")
                }
                appendLine()
                append("Apply these changes?")
            }
            val ok = Messages.showYesNoDialog(
                project,
                msg,
                "Local LLM — apply files",
                Messages.getQuestionIcon()
            )
            if (ok != Messages.YES) {
                appendLog("(File apply cancelled.)\n\n")
                onDone()
                return@invokeLater
            }
            try {
                val results = WriteCommandAction.writeCommandAction(project).compute<List<ProjectFileApplyService.ApplyResult>, RuntimeException> {
                    ProjectFileApplyService.applyAll(project, blocks)
                }
                val lines = results.joinToString("\n") { r ->
                    if (r.ok) "  ✓ ${r.path}" else "  ✗ ${r.path}: ${r.message}"
                }
                appendLog("Apply results:\n$lines\n\n")
                val anyFail = results.any { !it.ok }
                if (anyFail) {
                    Messages.showWarningDialog(
                        project,
                        "Some files could not be written. See the conversation log for details.",
                        "Local LLM"
                    )
                }
            } catch (e: Exception) {
                appendLog("Apply error: ${e.message ?: e}\n\n")
                Messages.showErrorDialog(project, e.message ?: e.toString(), "Local LLM")
            }
            onDone()
        }
    }
}
