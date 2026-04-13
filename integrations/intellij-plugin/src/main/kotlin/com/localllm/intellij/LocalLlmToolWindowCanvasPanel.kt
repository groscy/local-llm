package com.localllm.intellij

import com.intellij.ui.ColorUtil
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.Graphics
import java.awt.Graphics2D
import java.awt.RenderingHints
import javax.swing.JPanel

/**
 * Flat tool-window background derived from the theme (no gradients).
 */
class LocalLlmToolWindowCanvasPanel : JPanel(BorderLayout()) {

    init {
        isOpaque = false
    }

    override fun paintComponent(g: Graphics) {
        val g2 = g.create() as Graphics2D
        try {
            g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON)
            if (width <= 0 || height <= 0) return
            val bg = UIUtil.getPanelBackground()
            val fill = ColorUtil.mix(bg, LocalLlmUiTheme.linkColor(), 0.04)
            g2.color = fill
            g2.fillRect(0, 0, width, height)
        } finally {
            g2.dispose()
        }
    }
}
