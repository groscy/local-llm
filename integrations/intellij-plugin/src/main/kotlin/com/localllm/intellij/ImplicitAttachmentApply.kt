package com.localllm.intellij

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * When the model omits LOCAL_LLM_* / // File: markers but the user referenced concrete files (attachments),
 * map the reply onto those paths so it still lands in the right editors.
 */
object ImplicitAttachmentApply {

    fun inferEdits(project: Project, modelReply: String, referencedFiles: List<VirtualFile>): List<StructuredApplyParser.StructuredEdit> {
        val files = referencedFiles.filter { !it.isDirectory }
        if (files.isEmpty()) return emptyList()

        val anonymous = MarkdownFenceFileExtractor.anonymousCodeFenceBodies(modelReply)

        return when (files.size) {
            1 -> inferSingleFile(project, files[0], modelReply, anonymous)
            else -> inferMultipleFiles(project, files, anonymous)
        }
    }

    private fun inferSingleFile(
        project: Project,
        file: VirtualFile,
        modelReply: String,
        anonymous: List<String>
    ): List<StructuredApplyParser.StructuredEdit> {
        val rel = PromptAttachmentBundler.relativeProjectPath(project, file) ?: return emptyList()
        val body = when {
            anonymous.size > 1 -> return emptyList()
            anonymous.size == 1 -> anonymous[0].trim()
            else -> stripOuterCodeFence(modelReply.trim()).trim()
        }
        if (!looksLikeReplaceableSource(body)) return emptyList()
        return listOf(StructuredApplyParser.StructuredEdit.FullFile(rel, body))
    }

    private fun inferMultipleFiles(
        project: Project,
        files: List<VirtualFile>,
        anonymous: List<String>
    ): List<StructuredApplyParser.StructuredEdit> {
        if (anonymous.size != files.size) return emptyList()
        val out = ArrayList<StructuredApplyParser.StructuredEdit>(files.size)
        for ((vf, rawBody) in files.zip(anonymous)) {
            val rel = PromptAttachmentBundler.relativeProjectPath(project, vf) ?: return emptyList()
            val body = rawBody.trim()
            if (!looksLikeReplaceableSource(body)) return emptyList()
            out.add(StructuredApplyParser.StructuredEdit.FullFile(rel, body))
        }
        return out
    }

    /** If the whole reply is one ```…``` block, return inner text; otherwise the trimmed string. */
    private fun stripOuterCodeFence(text: String): String {
        val t = text.trim()
        if (!t.startsWith("```")) return t
        val nl = t.indexOf('\n')
        if (nl < 0) return t
        val close = t.lastIndexOf("```")
        if (close <= nl) return t
        return t.substring(nl + 1, close).trim()
    }

    private fun looksLikeReplaceableSource(s: String): Boolean {
        if (s.length < 12) return false
        if (s.contains("<<<LOCAL_LLM", ignoreCase = true)) return false
        val t = s.trimStart()
        if (t.startsWith("[CLARIFY]", ignoreCase = true)) return false

        val lines = s.lines().filter { it.isNotBlank() }
        if (lines.isEmpty()) return false
        val codeish = lines.count { ln ->
            val x = ln.trim()
            when {
                x.startsWith("//") || x.startsWith("/*") || x.startsWith("*") -> true
                x.startsWith("#") && (x.startsWith("#!") || x.startsWith("#include") || x.matches(Regex("""^#\s*\w+"""))) -> true
                x.any { it in "{}();=<>[]|&" } || x.startsWith("@") -> true
                Regex("""^(package|import|using|namespace)\s+""").containsMatchIn(x) -> true
                Regex("""\b(class|interface|object|enum\s+class|fun|val|var|typealias)\b""").containsMatchIn(x) -> true
                Regex("""^(public|private|protected|internal|open|abstract|sealed|data)\s+""").containsMatchIn(x) -> true
                Regex("""^(def|async|function|const|let|export)\s+""").containsMatchIn(x) -> true
                else -> false
            }
        }
        if (codeish < maxOf(1, (lines.size + 2) / 3)) return false

        val proseHeavy = lines.count { ln ->
            val x = ln.trim()
            x.length > 12 && !x.any { it in "{}();" } &&
                Regex("""^(Here|There|This |I |We |Note|Please|However|Therefore|So |Also )""", RegexOption.IGNORE_CASE).containsMatchIn(x)
        }
        if (proseHeavy > 2) return false

        return true
    }
}
