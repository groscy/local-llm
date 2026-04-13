package com.localllm.intellij

import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BasicStroke
import java.awt.BorderLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JPanel

/**
 * Card surface from theme colors — flat fill, rounded corners, accent stroke (no gradients).
 */
class LocalLlmGlassCardPanel(content: java.awt.Component) : JPanel(BorderLayout()) {

    init {
        isOpaque = false
        border = JBUI.Borders.empty(LocalLlmUiTheme.cardPadding())
        add(content, BorderLayout.CENTER)
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            val w = width
            val h = height
            if (w <= 0 || h <= 0) return
            val arc = minOf(LocalLlmUiTheme.cornerRadius(), w / 2, h / 2).coerceAtLeast(2)

            val bg = UIUtil.getPanelBackground()
            val dark = ColorUtil.isDark(bg)
            val fill = ColorUtil.withAlpha(
                ColorUtil.mix(
                    bg,
                    LocalLlmUiTheme.lighten(bg, if (dark) 0.05 else 0.08),
                    0.22
                ),
                (if (dark) 228 else 236) / 255.0
            )
            g2.color = fill
            g2.fillRoundRect(0, 0, w, h, arc, arc)

            g2.stroke = BasicStroke(JBUIScale.scale(1f))
            g2.color = ColorUtil.withAlpha(
                ColorUtil.mix(JBColor.border(), LocalLlmUiTheme.linkColor(), 0.52),
                (if (dark) 165 else 145) / 255.0
            )
            g2.drawRoundRect(0, 0, w - 1, h - 1, arc, arc)
        } finally {
            g2.dispose()
        }
    }
}
