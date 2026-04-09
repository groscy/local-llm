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
import com.intellij.openapi.fileEditor.OpenFileDescriptor
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
import com.intellij.util.ui.EmptyIcon
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

    private enum class ConnectionStepState {
        /** Earlier step failed or not evaluated yet. */
        WAITING,

        /** Currently checking (spinner-style icon). */
        PENDING,

        OK,
        FAIL
    }

    private val connectionStepIconPlaceholder = EmptyIcon.create(JBUIScale.scale(16))

    private val connectionStep1Icon = JLabel()
    private val connectionStep1Text = JLabel().apply { font = JBFont.label() }
    private val connectionStep2Icon = JLabel()
    private val connectionStep2Text = JLabel().apply { font = JBFont.label() }
    private val connectionStep3Icon = JLabel()
    private val connectionStep3Text = JLabel().apply { font = JBFont.label() }

    private val connectionDetailText = JBTextArea(2, 24).apply {
        isEditable = false
        isFocusable = false
        lineWrap = true
        wrapStyleWord = true
        font = JBFont.label()
        background = JBColor.PanelBackground
        border = JBUI.Borders.empty(4, 0, 0, 0)
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

    private val applyStructuredEdits = JBCheckBox(
        "Apply structured edits from replies (patches + full files, with confirm)",
        true
    ).apply {
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

        fun stepRow(icon: JLabel, text: JLabel): JPanel {
            icon.preferredSize = Dimension(JBUIScale.scale(20), JBUIScale.scale(18))
            icon.minimumSize = icon.preferredSize
            return JPanel(FlowLayout(FlowLayout.LEFT, JBUIScale.scale(6), JBUIScale.scale(2))).apply {
                isOpaque = false
                add(icon)
                add(text)
            }
        }

        val connectionChecklistPanel = JPanel().apply {
            layout = BoxLayout(this, BoxLayout.Y_AXIS)
            isOpaque = false
            border = JBUI.Borders.empty(2, 0, 0, 0)
            add(stepRow(connectionStep1Icon, connectionStep1Text))
            add(Box.createVerticalStrut(JBUIScale.scale(2)))
            add(stepRow(connectionStep2Icon, connectionStep2Text))
            add(Box.createVerticalStrut(JBUIScale.scale(2)))
            add(stepRow(connectionStep3Icon, connectionStep3Text))
        }

        val connectionBodyScroll = JBScrollPane(
            JPanel(BorderLayout()).apply {
                isOpaque = false
                add(connectionChecklistPanel, BorderLayout.NORTH)
                add(connectionDetailText, BorderLayout.CENTER)
            }
        ).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            minimumSize = Dimension(JBUIScale.scale(64), JBUIScale.scale(88))
            preferredSize = Dimension(JBUIScale.scale(220), JBUIScale.scale(108))
        }

        val statusStrip = JPanel(BorderLayout()).apply {
            border = JBUI.Borders.customLine(JBColor.border(), 1)
            background = JBColor.PanelBackground
            add(connectionBodyScroll, BorderLayout.CENTER)
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

    private fun applyConnectionStep(
        iconLabel: JLabel,
        textLabel: JLabel,
        state: ConnectionStepState,
        iconTooltip: String?
    ) {
        iconLabel.icon = when (state) {
            ConnectionStepState.WAITING -> connectionStepIconPlaceholder
            ConnectionStepState.PENDING -> AllIcons.Process.Step_1
            ConnectionStepState.OK -> AllIcons.General.GreenCheckmark
            ConnectionStepState.FAIL -> AllIcons.General.Error
        }
        iconLabel.toolTipText = iconTooltip
        textLabel.foreground = when (state) {
            ConnectionStepState.WAITING ->
                JBColor(Color(0x8E8E8E), Color(0x7A7A7A))
            ConnectionStepState.PENDING ->
                JBColor(Color(0x303030), Color(0xBBBBBB))
            ConnectionStepState.OK ->
                JBColor(Color(0x1B5E20), Color(0xC8E6C9))
            ConnectionStepState.FAIL ->
                JBColor(Color(0xB71C1C), Color(0xFF8A80))
        }
    }

    private fun setConnectionCheckingUi() {
        val port = integrationPort()
        val host = "127.0.0.1:$port"
        connectionStep1Text.text = "Reach integration server ($host)"
        connectionStep2Text.text = "GET /health returns HTTP 200"
        connectionStep3Text.text = "Model runtime is running"
        applyConnectionStep(connectionStep1Icon, connectionStep1Text, ConnectionStepState.PENDING, null)
        applyConnectionStep(connectionStep2Icon, connectionStep2Text, ConnectionStepState.WAITING, null)
        applyConnectionStep(connectionStep3Icon, connectionStep3Text, ConnectionStepState.WAITING, null)
        connectionDetailText.foreground = JBColor(Color(90, 90, 90), Color(180, 180, 180))
        connectionDetailText.text = "Checking…"
        connectionDetailText.caretPosition = 0
    }

    private fun applyBridgeHealthUi(health: LocalLlmHttpClient.BridgeHealth, port: Int) {
        val host = "127.0.0.1:$port"
        connectionStep1Text.text = "Reach integration server ($host)"
        connectionStep2Text.text = "GET /health returns HTTP 200"
        val kind = health.runtimeKind?.ifBlank { null }
        connectionStep3Text.text =
            if (kind != null) "Model runtime is running ($kind)" else "Model runtime is running"

        when {
            !health.reachable -> {
                applyConnectionStep(connectionStep1Icon, connectionStep1Text, ConnectionStepState.FAIL, "No TCP/HTTP response")
                applyConnectionStep(connectionStep2Icon, connectionStep2Text, ConnectionStepState.WAITING, null)
                applyConnectionStep(connectionStep3Icon, connectionStep3Text, ConnectionStepState.WAITING, null)
                val detail = health.errorHint?.take(280) ?: "Connection refused or timed out"
                connectionDetailText.foreground = JBColor(Color(0xB71C1C), Color(0xFF8A80))
                connectionDetailText.text =
                    "$detail\nEnable IDE integration under Local LLM Desktop → Settings and keep the app running."
            }
            health.httpStatus != 200 -> {
                applyConnectionStep(connectionStep1Icon, connectionStep1Text, ConnectionStepState.OK, null)
                applyConnectionStep(connectionStep2Icon, connectionStep2Text, ConnectionStepState.FAIL, "Non-200 response")
                applyConnectionStep(connectionStep3Icon, connectionStep3Text, ConnectionStepState.WAITING, null)
                connectionDetailText.foreground = JBColor(Color(0xE65100), Color(0xFFCC80))
                connectionDetailText.text =
                    "Bridge responded with HTTP ${health.httpStatus} — $host\n${health.errorHint ?: ""}".trimEnd()
            }
            health.runtimeRunning == true -> {
                applyConnectionStep(connectionStep1Icon, connectionStep1Text, ConnectionStepState.OK, null)
                applyConnectionStep(connectionStep2Icon, connectionStep2Text, ConnectionStepState.OK, null)
                applyConnectionStep(connectionStep3Icon, connectionStep3Text, ConnectionStepState.OK, null)
                connectionDetailText.foreground = JBColor(Color(0x1B5E20), Color(0xA5D6A7))
                connectionDetailText.text = "Ready — chat requests use the desktop runtime."
            }
            else -> {
                applyConnectionStep(connectionStep1Icon, connectionStep1Text, ConnectionStepState.OK, null)
                applyConnectionStep(connectionStep2Icon, connectionStep2Text, ConnectionStepState.OK, null)
                applyConnectionStep(connectionStep3Icon, connectionStep3Text, ConnectionStepState.FAIL, "Runtime not started")
                connectionDetailText.foreground = JBColor(Color(0x6A1B9A), Color(0xCE93D8))
                connectionDetailText.text =
                    "Bridge is up but no model is running. Open Run in Local LLM Desktop and start your model."
            }
        }
        connectionDetailText.caretPosition = 0
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

    /** Best-effort POST to Local LLM Desktop so the Electron app can show IDE activity (pinned Activity widget). */
    private fun notifyDesktop(kind: String, message: String?, meta: Map<String, Any?> = emptyMap()) {
        val port = integrationPort()
        val token = PropertiesComponent.getInstance().getValue("localLlm.integrationToken") ?: ""
        ApplicationManager.getApplication().executeOnPooledThread {
            LocalLlmHttpClient.postPluginReport(port, token, "intellij", kind, message, meta)
        }
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
                        PromptAttachmentBundler.bundle(project, basePrompt, files, indicator)
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
                        attachmentCount = files.size,
                        onLog = { line ->
                            ApplicationManager.getApplication().invokeLater { appendLog(line) }
                        }
                    )
                } catch (_: ProcessCanceledException) {
                    ApplicationManager.getApplication().invokeLater {
                        notifyDesktop("send_cancelled", "Send cancelled", mapOf("project" to project.name))
                        appendLog("(Cancelled.)\n\n")
                        finishSendTurn(false)
                    }
                } catch (e: Exception) {
                    ApplicationManager.getApplication().invokeLater {
                        val net = e is IOException || LocalLlmHttpClient.isConnectFailure(e)
                        if (net) {
                            notifyDesktop(
                                "chat_failed",
                                e.message?.take(200),
                                mapOf("project" to project.name, "reason" to "prepare_or_network")
                            )
                            appendLog(
                                "Connection error · 127.0.0.1:$port · ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                                    "See the status bar at the top of this tool window. Enable IDE integration in Local LLM Desktop.\n\n"
                            )
                            refreshConnectionStatus()
                        } else {
                            notifyDesktop("chat_failed", e.message?.take(200), mapOf("project" to project.name))
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
        attachmentCount: Int,
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
                notifyDesktop(
                    "chat_failed",
                    "HTTP ${e.status}",
                    mapOf("project" to project.name, "httpStatus" to e.status)
                )
                onLog("HTTP ${e.status}: ${e.body.take(800)}\n\n")
                ApplicationManager.getApplication().invokeLater { refreshConnectionStatus() }
                finishSendTurn(false)
                return
            } catch (e: IOException) {
                notifyDesktop(
                    "chat_failed",
                    e.message?.take(200),
                    mapOf("project" to project.name, "reason" to "io")
                )
                onLog(
                    "Cannot reach Local LLM Desktop at 127.0.0.1:$port — ${e.javaClass.simpleName}: ${e.message ?: ""}\n" +
                        "Check the connection strip above (GET /health). Enable IDE integration in the desktop app.\n\n"
                )
                ApplicationManager.getApplication().invokeLater { refreshConnectionStatus() }
                finishSendTurn(false)
                return
            } catch (e: Exception) {
                if (LocalLlmHttpClient.isConnectFailure(e)) {
                    notifyDesktop(
                        "chat_failed",
                        e.message?.take(200),
                        mapOf("project" to project.name, "reason" to "connect")
                    )
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
                    val meta = mutableMapOf<String, Any?>(
                        "project" to project.name,
                        "attachments" to attachmentCount,
                        "includeGraph" to includeGraph,
                        "clarificationRounds" to round
                    )
                    completion.promptTokens?.let { meta["promptTokens"] = it }
                    completion.completionTokens?.let { meta["completionTokens"] = it }
                    notifyDesktop("chat_completed", project.name, meta)
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
                        notifyDesktop("send_cancelled", "Clarification timed out", mapOf("project" to project.name))
                        onLog("(Timed out waiting for clarification.)\n\n")
                        finishSendTurn(false)
                        return
                    }
                    val clarificationText = answers
                    if (clarificationText.isNullOrBlank()) {
                        notifyDesktop("send_cancelled", "Clarification cancelled", mapOf("project" to project.name))
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
        notifyDesktop("chat_failed", "Max clarification rounds", mapOf("project" to project.name))
        onLog("Model: (max clarification rounds reached — try a more specific prompt.)\n\n")
        finishSendTurn(false)
    }

    /**
     * If the model reply contains LOCAL_LLM_PATCH and/or LOCAL_LLM_FILE blocks and the user opted in,
     * prompt and apply under the project root (patches = search/replace; files = full replace).
     */
    private fun offerApplyStructuredEdits(modelReply: String, onDone: () -> Unit) {
        if (!applyStructuredEdits.isSelected) {
            onDone()
            return
        }
        val edits = StructuredApplyParser.parseStructuredEdits(modelReply)
        if (edits.isEmpty()) {
            onDone()
            return
        }
        ApplicationManager.getApplication().invokeLater {
            val patchCount = edits.count { it is StructuredApplyParser.StructuredEdit.Patch }
            val fileCount = edits.count { it is StructuredApplyParser.StructuredEdit.FullFile }
            val msg = buildString {
                appendLine(
                    "The model returned ${edits.size} structured edit(s): " +
                        "$patchCount patch(es) (search/replace), $fileCount full file(s). " +
                        "Full files replace the entire path on disk (UTF-8); patches require an existing file."
                )
                appendLine()
                for (e in edits) {
                    when (e) {
                        is StructuredApplyParser.StructuredEdit.Patch ->
                            appendLine("· PATCH ${e.path} (${e.hunks.size} hunk(s))")
                        is StructuredApplyParser.StructuredEdit.FullFile ->
                            appendLine("· FILE  ${e.path} (full replace)")
                    }
                }
                appendLine()
                append("Apply these changes?")
            }
            val ok = Messages.showYesNoDialog(
                project,
                msg,
                "Local LLM — apply to project",
                Messages.getQuestionIcon()
            )
            if (ok != Messages.YES) {
                notifyDesktop(
                    "apply_cancelled",
                    "User declined structured apply",
                    mapOf("project" to project.name, "edits" to edits.size)
                )
                appendLog("(Apply cancelled.)\n\n")
                onDone()
                return@invokeLater
            }
            try {
                val results = WriteCommandAction.writeCommandAction(project).compute<List<ProjectFileApplyService.ApplyResult>, RuntimeException> {
                    ProjectFileApplyService.applyStructuredEdits(project, edits)
                }
                val lines = results.joinToString("\n") { r ->
                    if (r.ok) "  ✓ ${r.path}" else "  ✗ ${r.path}: ${r.message}"
                }
                appendLog("Apply results:\n$lines\n\n")
                val okN = results.count { it.ok }
                val failN = results.size - okN
                notifyDesktop(
                    "apply_completed",
                    "${project.name}: $okN ok, $failN failed",
                    mapOf(
                        "project" to project.name,
                        "filesTotal" to results.size,
                        "filesOk" to okN,
                        "filesFailed" to failN
                    )
                )
                val anyFail = results.any { !it.ok }
                if (anyFail) {
                    Messages.showWarningDialog(
                        project,
                        "Some edits could not be applied. See the conversation log for details.",
                        "Local LLM"
                    )
                }
                val firstOkPath = results.firstOrNull { it.ok }?.path
                val base = project.basePath
                if (firstOkPath != null && base != null) {
                    val target = ProjectFileApplyService.resolveUnderProject(base, firstOkPath)
                    if (target != null) {
                        val vf = LocalFileSystem.getInstance().refreshAndFindFileByIoFile(target.toFile())
                        if (vf != null) {
                            OpenFileDescriptor(project, vf).navigate(true)
                        }
                    }
                }
            } catch (e: Exception) {
                notifyDesktop("apply_failed", e.message?.take(200), mapOf("project" to project.name))
                appendLog("Apply error: ${e.message ?: e}\n\n")
                Messages.showErrorDialog(project, e.message ?: e.toString(), "Local LLM")
            }
            onDone()
        }
    }
}
