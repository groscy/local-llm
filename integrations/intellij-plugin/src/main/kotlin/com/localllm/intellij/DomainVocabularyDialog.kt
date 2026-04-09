package com.localllm.intellij

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextArea
import java.awt.Dimension
import javax.swing.Action
import javax.swing.JComponent
import javax.swing.ScrollPaneConstants

/** Read-only report of [DomainVocabularyCollector] output. */
class DomainVocabularyDialog(project: Project, private val report: String) : DialogWrapper(project) {

    private val area = JBTextArea(report).apply {
        isEditable = false
        lineWrap = true
        wrapStyleWord = true
        rows = 18
        columns = 64
    }

    init {
        title = "Domain vocabulary"
        init()
        okAction.putValue(Action.NAME, "Close")
    }

    override fun createCenterPanel(): JComponent =
        JBScrollPane(area).apply {
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_AS_NEEDED
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            preferredSize = Dimension(680, 440)
            minimumSize = Dimension(280, 160)
        }
}
