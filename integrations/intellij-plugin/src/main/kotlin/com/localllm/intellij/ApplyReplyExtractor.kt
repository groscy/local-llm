package com.localllm.intellij

/**
 * When the model mixes explanations with IDE-apply payloads, we keep only the apply regions for
 * transcript + [apiHistory] so the thread reads like raw edits (as if the user pasted them).
 */
object ApplyReplyExtractor {

    private data class Region(val start: Int, val endExclusive: Int)

    /**
     * Returns merged apply text from the raw reply, or null if there are no LOCAL_LLM blocks or path-tagged fences.
     */
    fun applyPayloadOnlyOrNull(rawReply: String): String? {
        val regions = mutableListOf<Region>()
        for ((a, b) in StructuredApplyParser.localLlmApplyRegions(rawReply)) {
            regions.add(Region(a, b))
        }
        for ((a, b) in MarkdownFenceFileExtractor.pathTaggedFenceRegions(rawReply)) {
            regions.add(Region(a, b))
        }
        if (regions.isEmpty()) return null
        val merged = mergeRegions(regions)
        val s = merged.joinToString("\n\n") { rawReply.substring(it.start, it.endExclusive) }.trim()
        return s.takeIf { it.isNotEmpty() }
    }

    private fun mergeRegions(regions: List<Region>): List<Region> {
        val sorted = regions.sortedBy { it.start }
        val out = mutableListOf<Region>()
        var cur = sorted[0]
        for (i in 1 until sorted.size) {
            val n = sorted[i]
            cur = if (n.start < cur.endExclusive) {
                Region(cur.start, maxOf(cur.endExclusive, n.endExclusive))
            } else {
                out.add(cur)
                n
            }
        }
        out.add(cur)
        return out
    }
}
