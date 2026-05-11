package com.localllm.intellij

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class StructuredApplyParserTest {

    @Test
    fun parsesFilePatchAndDeleteInOrder() {
        val reply = """
            <<<LOCAL_LLM_FILE path="src/A.kt">>>
            class A
            <<<END_LOCAL_LLM_FILE>>>

            <<<LOCAL_LLM_PATCH path="src/B.kt">>>
            <<<< SEARCH
            old
            ====
            new
            >>>>
            <<<END_LOCAL_LLM_PATCH>>>

            <<<LOCAL_LLM_DELETE path="src/C.kt">>>
            <<<END_LOCAL_LLM_DELETE>>>
        """.trimIndent()

        val edits = StructuredApplyParser.parseStructuredEdits(reply)
        assertEquals(3, edits.size)
        assertTrue(edits[0] is StructuredApplyParser.StructuredEdit.FullFile)
        assertTrue(edits[1] is StructuredApplyParser.StructuredEdit.Patch)
        assertTrue(edits[2] is StructuredApplyParser.StructuredEdit.DeleteFile)
        val del = edits[2] as StructuredApplyParser.StructuredEdit.DeleteFile
        assertEquals("src/C.kt", del.path)
    }

    @Test
    fun applyRegionsIncludeDeleteBlocks() {
        val reply = """
            before
            <<<LOCAL_LLM_DELETE path="src/Dead.kt">>>
            <<<END_LOCAL_LLM_DELETE>>>
            after
        """.trimIndent()
        val regions = StructuredApplyParser.localLlmApplyRegions(reply)
        assertEquals(1, regions.size)
        val (start, end) = regions[0]
        val extracted = reply.substring(start, end)
        assertTrue(extracted.contains("LOCAL_LLM_DELETE"))
        assertTrue(extracted.contains("END_LOCAL_LLM_DELETE"))
    }
}
