package com.localllm.intellij

import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.ValidationInfo
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.JBUI
import java.awt.Dimension
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ScrollPaneConstants

/**
 * Single dialog collecting answers for all `[CLARIFY]` questions (avoids stacked modal input boxes).
 */
class ClarifyQuestionsDialog(
    project: Project,
    private val questions: List<String>
) : DialogWrapper(project) {

    private val fields: List<JBTextField> = questions.map { JBTextField() }

    init {
        title = "Local LLM — clarify"
        init()
    }

    override fun doValidate(): ValidationInfo? {
        for (f in fields) {
            if (f.text.isBlank()) {
                return ValidationInfo("Please answer all questions.", f)
            }
        }
        return null
    }

    override fun createCenterPanel(): JComponent {
        val inner = JPanel(GridBagLayout()).apply { border = JBUI.Borders.empty(4) }
        val c = GridBagConstraints().apply {
            gridx = 0
            anchor = GridBagConstraints.NORTHWEST
            fill = GridBagConstraints.HORIZONTAL
            weightx = 1.0
            insets = JBUI.insets(0, 0, 8, 0)
        }
        for (i in questions.indices) {
            c.gridy = i * 2
            c.weighty = 0.0
            inner.add(JBLabel("${i + 1}. ${questions[i]}"), c)
            c.gridy = i * 2 + 1
            c.insets = JBUI.insets(0, 0, 12, 0)
            inner.add(fields[i], c)
            c.insets = JBUI.insets(0, 0, 8, 0)
        }
        c.gridy = questions.size * 2
        c.weighty = 1.0
        inner.add(JPanel(), c)

        return JBScrollPane(inner).apply {
            border = JBUI.Borders.empty()
            horizontalScrollBarPolicy = ScrollPaneConstants.HORIZONTAL_SCROLLBAR_NEVER
            verticalScrollBarPolicy = ScrollPaneConstants.VERTICAL_SCROLLBAR_AS_NEEDED
            preferredSize = Dimension(520, minOf(360, 80 + questions.size * 72))
        }
    }

    override fun getPreferredFocusedComponent(): JComponent? = fields.firstOrNull()

    /** Lines parallel to [questions]; only valid after OK. */
    fun answersLines(): List<String> = fields.map { it.text.trim() }
}
