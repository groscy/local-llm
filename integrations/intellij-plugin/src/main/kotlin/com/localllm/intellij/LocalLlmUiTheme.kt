package com.localllm.intellij

import com.intellij.ui.ColorUtil
import com.intellij.ui.JBColor
import com.intellij.ui.scale.JBUIScale
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.Color
import java.awt.Component
import javax.swing.JPanel
import javax.swing.border.Border

/**
 * Chrome is derived from the active IntelliJ theme ([UIUtil], [JBColor], [ColorUtil]).
 * [isDarkSurface] uses luminance so custom dark themes work, not only Darcula.
 */
object LocalLlmUiTheme {

    fun panelBackground(): Color = UIUtil.getPanelBackground()

    /** Theme link / accent (falls back if the key is absent). */
    fun linkColor(): Color = JBColor.namedColor(
        "link.foreground",
        JBColor(Color(0x247CBD), Color(0x6BA3F5))
    )

    fun toolbarBackdrop(): Color =
        ColorUtil.withAlpha(panelBackground(), 242.0 / 255.0)

    fun editorLikeSurface(): Color {
        val panel = panelBackground()
        val tf = UIUtil.getTextFieldBackground()
        return if (tf == null || tf == panel) {
            ColorUtil.mix(panel, UIUtil.getListBackground(), 0.48)
        } else {
            ColorUtil.mix(panel, tf, 0.52)
        }
    }

    fun accentBorderColor(): Color {
        val border = JBColor.border()
        return ColorUtil.withAlpha(ColorUtil.mix(border, linkColor(), 0.62), 190.0 / 255.0)
    }

    fun innerChromeBorder(): Border =
        JBUI.Borders.customLine(accentBorderColor(), 1)

    fun cardPadding(): Int = JBUIScale.scale(10)

    fun sectionGap(): Int = JBUIScale.scale(8)

    fun cornerRadius(): Int = JBUIScale.scale(12)

    fun chatCardShell(center: Component): JPanel =
        LocalLlmGlassCardPanel(center)

    fun isDarkSurface(): Boolean = ColorUtil.isDark(panelBackground())

    fun secondaryLabelForeground(): Color = UIUtil.getContextHelpForeground()

    fun accentLabelForeground(): Color {
        val fg = UIUtil.getLabelForeground()
        return ColorUtil.mix(fg, linkColor(), 0.38)
    }

    fun deepen(c: Color, amount: Double): Color =
        ColorUtil.mix(c, Color.BLACK, amount.coerceIn(0.0, 0.5))

    fun lighten(c: Color, amount: Double): Color =
        ColorUtil.mix(c, Color.WHITE, amount.coerceIn(0.0, 0.45))
}
