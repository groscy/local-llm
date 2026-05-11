package com.localllm.intellij

import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectFileApplyServicePathTest {

    @Test
    fun resolveUnderProjectAllowsRelativeChild() {
        val resolved = ProjectFileApplyService.resolveUnderProject("C:/repo", "src/main/App.kt")
        assertNotNull(resolved)
        assertTruePathEndsWith(resolved.toString(), "repo/src/main/App.kt")
    }

    @Test
    fun resolveUnderProjectRejectsTraversal() {
        val resolved = ProjectFileApplyService.resolveUnderProject("C:/repo", "../outside.txt")
        assertNull(resolved)
    }

    @Test
    fun resolveUnderProjectRejectsEmpty() {
        val resolved = ProjectFileApplyService.resolveUnderProject("C:/repo", "   ")
        assertNull(resolved)
    }

    @Test
    fun resolveUnderProjectRejectsDotSegments() {
        val resolved = ProjectFileApplyService.resolveUnderProject("C:/repo", "./src/Main.kt")
        assertNull(resolved)
    }

    private fun assertTruePathEndsWith(actual: String, suffix: String) {
        val normalizedActual = actual.replace('\\', '/')
        assertTrue(normalizedActual.endsWith(suffix))
    }
}
