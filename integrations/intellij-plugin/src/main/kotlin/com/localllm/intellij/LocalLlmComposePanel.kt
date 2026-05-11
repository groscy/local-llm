package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.SeparatorFactory
import com.intellij.ui.ToolbarDecorator
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBFont
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Dimension
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.DefaultListCellRenderer
import javax.swing.DefaultListModel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListSelectionModel
import javax.swing.ScrollPaneConstants

/** Prompt, attachments, and toggles for a chat turn. */
class LocalLlmComposePanel(private val project: Project) : JPanel(BorderLayout()) {

    private var enterToSend: (() -> Unit)? = null

    /** Enter sends; Shift+Enter inserts a newline (same idea as the desktop chat composer). */
    fun setEnterToSend(handler: () -> Unit) {
        enterToSend = handler
    }

    val fileModel = DefaultListModel<VirtualFile>()
    private val fileList = JBList(fileModel).apply {
        layoutOrientation = JList.HORIZONTAL_WRAP
        visibleRowCount = 1
        selectionMode = ListSelectionModel.MULTIPLE_INTERVAL_SELECTION
        fixedCellHeight = JBUIScale.scale(22)
        isOpaque = true
        background = LocalLlmUiTheme.editorLikeSurface()
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

    val promptArea = JBTextArea(5, 36).apply {
        lineWrap = true
        wrapStyleWord = true
        font = JBFont.label().biggerOn(1f)
        border = JBUI.Borders.empty(8)
        isOpaque = true
        background = LocalLlmUiTheme.editorLikeSurface()
        addKeyListener(object : KeyAdapter() {
            override fun keyPressed(e: KeyEvent) {
                if (e.keyCode != KeyEvent.VK_ENTER || e.isShiftDown) return
                e.consume()
                enterToSend?.invoke()
            }
        })
    }

    private val progressLabel = JBLabel("Idle").apply {
        font = JBFont.label()
        border = JBUI.Borders.empty(6, 8)
        isOpaque = true
        background = LocalLlmUiTheme.editorLikeSurface()
        foreground = LocalLlmUiTheme.accentLabelForeground()
    }

    val includeGraph = JBCheckBox("Include structural codebase graph (Java / Kotlin)", true).apply {
        border = JBUI.Borders.empty(0, 0, 0, JBUIScale.scale(4))
    }

    val applyStructuredEdits = JBCheckBox(
        "Allow model file changes (preview shown before apply)",
        false
    ).apply {
        border = JBUI.Borders.empty(JBUIScale.scale(4), 0, 0, JBUIScale.scale(4))
    }

    private val advancedPanel = JPanel().apply {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)
        alignmentX = Component.LEFT_ALIGNMENT
        isOpaque = false
        border = JBUI.Borders.empty(4, 0, 0, JBUIScale.scale(18))
        add(includeGraph.apply { alignmentX = Component.LEFT_ALIGNMENT })
        add(Box.createVerticalStrut(JBUIScale.scale(2)))
        add(applyStructuredEdits.apply { alignmentX = Component.LEFT_ALIGNMENT })
    }

    private val advancedToggle = JBCheckBox("Show advanced options").apply {
        font = JBFont.label().deriveFont(JBFont.label().size2D - 1f)
        isOpaque = false
        isSelected = LocalLlmIntegrationProperties.advancedOptionsExpanded()
        addActionListener {
            LocalLlmIntegrationProperties.setAdvancedOptionsExpanded(isSelected)
            advancedPanel.isVisible = isSelected
        }
    }

    init {
        isOpaque = false
        border = JBUI.Borders.emptyBottom(JBUIScale.scale(8))
        val props = PropertiesComponent.getInstance()
        applyStructuredEdits.isSelected = props.getBoolean("localLlm.applyStructuredEdits", false)
        applyStructuredEdits.addActionListener {
            PropertiesComponent.getInstance().setValue(
                "localLlm.applyStructuredEdits",
                applyStructuredEdits.isSelected,
                false
            )
        }

        val fileToolbarPanel = ToolbarDecorator.createDecorator(fileList)
            .setAddAction {
                val descriptor = FileChooserDescriptorFactory.createMultipleFilesNoJarsDescriptor().apply {
                    title = "Attach code files"
                    description = "Files are appended to your prompt as labeled code blocks (text only)."
                    isShowFileSystemRoots = false
                }
                val chosen = FileChooser.chooseFiles(descriptor, this@LocalLlmComposePanel, project, null)
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
            .apply {
                isOpaque = true
                background = LocalLlmUiTheme.editorLikeSurface()
            }

        val promptScroll = JBScrollPane(promptArea).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            minimumSize = Dimension(JBUIScale.scale(100), JBUIScale.scale(64))
            viewport.isOpaque = true
            viewport.background = LocalLlmUiTheme.editorLikeSurface()
        }

        val promptBox = JPanel(BorderLayout()).apply {
            isOpaque = true
            border = LocalLlmUiTheme.innerChromeBorder()
            background = LocalLlmUiTheme.editorLikeSurface()
            add(fileToolbarPanel, BorderLayout.NORTH)
            add(
                JPanel(BorderLayout()).apply {
                    border = JBUI.Borders.customLine(com.intellij.ui.JBColor.border(), 0, 1, 0, 0)
                    isOpaque = false
                    add(promptScroll, BorderLayout.CENTER)
                },
                BorderLayout.CENTER
            )
        }

        val progressBox = JPanel(BorderLayout()).apply {
            isOpaque = false
            border = JBUI.Borders.empty(8, 0, 0, 0)
            add(SeparatorFactory.createSeparator("Prompt progress", null), BorderLayout.NORTH)
            add(
                JPanel(BorderLayout()).apply {
                    border = LocalLlmUiTheme.innerChromeBorder()
                    isOpaque = true
                    background = LocalLlmUiTheme.editorLikeSurface()
                    add(progressLabel, BorderLayout.CENTER)
                },
                BorderLayout.CENTER
            )
        }

        advancedPanel.isVisible = false

        val body = JPanel(GridBagLayout()).apply {
            isOpaque = false
            val c = GridBagConstraints().apply {
                gridx = 0
                weightx = 1.0
                fill = GridBagConstraints.HORIZONTAL
                anchor = GridBagConstraints.NORTH
            }
            c.gridy = 0
            c.weighty = 1.0
            c.fill = GridBagConstraints.BOTH
            c.insets = JBUI.insets(0, 0, 8, 0)
            add(promptBox, c)
            c.gridy = 1
            c.weighty = 0.0
            c.fill = GridBagConstraints.HORIZONTAL
            c.insets = JBUI.insets(8, 0, 0, 0)
            add(progressBox, c)
        }

        add(SeparatorFactory.createSeparator("Your message", null), BorderLayout.NORTH)
        add(body, BorderLayout.CENTER)
    }

    fun addFileUnique(vf: VirtualFile) {
        for (i in 0 until fileModel.size()) {
            if (fileModel.getElementAt(i).path == vf.path) return
        }
        fileModel.addElement(vf)
    }

    fun snapshotFiles(): List<VirtualFile> {
        val out = ArrayList<VirtualFile>(fileModel.size())
        for (i in 0 until fileModel.size()) {
            out.add(fileModel.getElementAt(i))
        }
        return out
    }

    fun snapshotFilesForSend(): List<VirtualFile> {
        val ordered = LinkedHashMap<String, VirtualFile>()
        resolveActiveEditorFile()?.let { ordered[it.path] = it }
        for (f in snapshotFiles()) {
            ordered.putIfAbsent(f.path, f)
        }
        return ordered.values.toList()
    }

    fun appendOutput(text: String) {
        val normalized = text.lineSequence().lastOrNull { it.isNotBlank() }?.trim().orEmpty()
        if (normalized.isBlank()) return
        setProgress(normalized)
    }

    fun appendOutputSection(title: String, body: String) {
        val compact = if (title.equals("Apply results", ignoreCase = true)) {
            val ok = Regex("""^\s*✓\s""", RegexOption.MULTILINE).findAll(body).count()
            val fail = Regex("""^\s*✗\s""", RegexOption.MULTILINE).findAll(body).count()
            "Apply finished: $ok ok, $fail failed"
        } else {
            title
        }
        setProgress(compact)
    }

    fun clearOutput() {
        setProgress("Idle")
    }

    fun setProgress(status: String) {
        val compact = status.replace('\n', ' ').replace(Regex("\\s+"), " ").trim().take(220)
        if (compact.isBlank()) return
        progressLabel.text = compact
        progressLabel.foreground = LocalLlmUiTheme.accentLabelForeground()
    }

    fun setProgressError(status: String) {
        val compact = status.replace('\n', ' ').replace(Regex("\\s+"), " ").trim().take(220)
        if (compact.isBlank()) return
        progressLabel.text = compact
        progressLabel.foreground = com.intellij.ui.JBColor.RED
    }

    private fun resolveActiveEditorFile(): VirtualFile? {
        val manager = FileEditorManager.getInstance(project)
        val fromEditor = manager.selectedTextEditor?.let { editor ->
            FileDocumentManager.getInstance().getFile(editor.document)
        }
        if (fromEditor != null && !fromEditor.isDirectory) return fromEditor
        return manager.selectedFiles.firstOrNull { !it.isDirectory }
    }
}
