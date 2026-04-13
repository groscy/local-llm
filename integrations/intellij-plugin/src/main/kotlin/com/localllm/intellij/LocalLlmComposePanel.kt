package com.localllm.intellij

import com.intellij.icons.AllIcons
import com.intellij.ide.util.PropertiesComponent
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileChooser.FileChooser
import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
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

    val fileModel = DefaultListModel<com.intellij.openapi.vfs.VirtualFile>()
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
                if (value is com.intellij.openapi.vfs.VirtualFile) {
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

    val includeGraph = JBCheckBox("Include structural codebase graph (Java / Kotlin)", true).apply {
        border = JBUI.Borders.empty(0, 0, 0, JBUIScale.scale(4))
    }

    val applyStructuredEdits = JBCheckBox(
        "Write model file changes to the project (patches, LOCAL_LLM blocks, // File: code fences)",
        true
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
        applyStructuredEdits.isSelected =
            PropertiesComponent.getInstance().getBoolean("localLlm.applyStructuredEdits", true)
        applyStructuredEdits.addActionListener {
            PropertiesComponent.getInstance().setValue(
                "localLlm.applyStructuredEdits",
                applyStructuredEdits.isSelected,
                true
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

        advancedPanel.isVisible = advancedToggle.isSelected

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
            c.insets = JBUI.insets(0, 0, 0, 0)
            add(advancedToggle, c)
            c.gridy = 2
            add(advancedPanel, c)
        }

        add(SeparatorFactory.createSeparator("Your message", null), BorderLayout.NORTH)
        add(body, BorderLayout.CENTER)
    }

    fun addFileUnique(vf: com.intellij.openapi.vfs.VirtualFile) {
        for (i in 0 until fileModel.size()) {
            if (fileModel.getElementAt(i).path == vf.path) return
        }
        fileModel.addElement(vf)
    }

    fun snapshotFiles(): List<com.intellij.openapi.vfs.VirtualFile> {
        val out = ArrayList<com.intellij.openapi.vfs.VirtualFile>(fileModel.size())
        for (i in 0 until fileModel.size()) {
            out.add(fileModel.getElementAt(i))
        }
        return out
    }
}
