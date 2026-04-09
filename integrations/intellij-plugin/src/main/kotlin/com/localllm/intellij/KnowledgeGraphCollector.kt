package com.localllm.intellij

import com.intellij.openapi.fileEditor.impl.LoadTextUtil
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiClass
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiJavaFile
import com.intellij.psi.PsiManager
import com.intellij.psi.PsiMethod

/**
 * Builds a text description of a structural knowledge graph: files, types, inheritance, member signatures.
 * Kotlin sources are parsed from **plain text** (no `org.jetbrains.kotlin.psi` dependency) so the plugin stays
 * compatible with the Kotlin plugin in **K2** mode.
 */
object KnowledgeGraphCollector {

    private const val MAX_FILES = 180
    private const val MAX_OUTPUT_CHARS = 95_000

    /** `class` / `interface` / `object` / `enum class` with optional supertypes on the same line. */
    private val KT_TYPE_DECL = Regex(
        """^(?:@[\w.]+\s+)*(?:(?:data|sealed|inner|abstract|open|private|internal|protected|public|final)\s+)*(?:enum\s+)?(class|interface|object)\s+(\w+)(?:\s*:\s*([^({]+))?"""
    )

    /** Top-level or member `fun` / `suspend fun` (first line only; signature truncated). */
    private val KT_FUN = Regex(
        """^(?:@[\w.]+\s+)*(?:private|internal|protected|public|override|suspend\s+)*fun\s+(?:[\w.`]+\.)?(\w+)\s*[\(<]"""
    )

    fun collect(project: Project, indicator: ProgressIndicator?): String {
        val sb = StringBuilder()
        sb.appendLine("# Code knowledge graph (structural)")
        sb.appendLine("Project: ${project.name}")
        sb.appendLine("Legend: CLASS / TOP_LEVEL — types; extends / implements / supertype — edges; METHOD / PROPERTY — members.")
        sb.appendLine("(Kotlin: text heuristics; compatible with Kotlin K2 analysis in the IDE.)")
        sb.appendLine()

        var fileCount = 0
        var truncated = false
        val modules = ModuleManager.getInstance(project).modules
        val psiManager = PsiManager.getInstance(project)

        outer@ for (module in modules) {
            indicator?.checkCanceled()
            val roots = ModuleRootManager.getInstance(module).sourceRoots
            for (root in roots) {
                VfsUtilCore.iterateChildrenRecursively(root, null) { file: VirtualFile ->
                    indicator?.checkCanceled()
                    if (sb.length >= MAX_OUTPUT_CHARS) {
                        truncated = true
                        return@iterateChildrenRecursively false
                    }
                    if (file.isDirectory) return@iterateChildrenRecursively true
                    if (fileCount >= MAX_FILES) {
                        truncated = true
                        return@iterateChildrenRecursively false
                    }
                    when {
                        file.name.endsWith(".java") -> {
                            val psi = psiManager.findFile(file) as? PsiJavaFile ?: return@iterateChildrenRecursively true
                            sb.appendLine("## FILE ${file.path}")
                            for (cls in psi.classes) {
                                appendJavaClass(sb, cls, 0)
                            }
                            sb.appendLine()
                            fileCount++
                        }
                        file.name.endsWith(".kt") -> {
                            sb.appendLine("## FILE ${file.path}")
                            val text = loadKotlinSourceText(file, psiManager)
                            if (text == null) {
                                sb.appendLine("  (Could not read file text.)")
                            } else {
                                appendKotlinGraphFromText(sb, text)
                            }
                            sb.appendLine()
                            fileCount++
                        }
                    }
                    true
                }
                if (truncated || sb.length >= MAX_OUTPUT_CHARS) break@outer
            }
        }

        if (fileCount == 0) {
            sb.appendLine("(No .java/.kt sources found under module source roots.)")
        }
        if (truncated) {
            sb.appendLine()
            sb.appendLine("… [graph truncated: file or size limit reached; some packages may be missing]")
        }
        return sb.toString()
    }

    private fun loadKotlinSourceText(file: VirtualFile, psiManager: PsiManager): String? {
        val psi: PsiFile? = psiManager.findFile(file)
        val fromPsi = psi?.text
        if (!fromPsi.isNullOrBlank()) return fromPsi
        return runCatching { LoadTextUtil.loadText(file).toString() }.getOrNull()
    }

    private fun appendKotlinGraphFromText(sb: StringBuilder, text: String) {
        val lines = text.lines()
        for (raw in lines) {
            if (sb.length >= MAX_OUTPUT_CHARS) return
            val line = raw.trim()
            if (line.isEmpty()) continue
            if (line.startsWith("//") || line.startsWith("*") || line.startsWith("import ")) continue
            if (line.startsWith("@file:")) continue

            if (line.startsWith("package ")) {
                val pkg = line.removePrefix("package ").substringBefore(';').trim()
                if (pkg.isNotEmpty()) sb.appendLine("  PACKAGE $pkg")
                continue
            }

            KT_TYPE_DECL.find(line)?.let { m ->
                val kind = m.groupValues[1]
                val name = m.groupValues[2]
                sb.appendLine("  CLASS $name ($kind)")
                val supers = m.groupValues[3].trim().takeIf { it.isNotEmpty() }
                supers?.split(",")?.map { it.trim() }?.filter { it.isNotEmpty() }?.forEach { s ->
                    sb.appendLine("    supertype $s")
                }
            }

            KT_FUN.find(line)?.let { m ->
                val name = m.groupValues[1]
                val sig = line.take(160)
                sb.appendLine("  FUN $name — $sig")
            }
        }
    }

    private fun appendJavaClass(sb: StringBuilder, cls: PsiClass, depth: Int) {
        if (sb.length >= MAX_OUTPUT_CHARS) return
        val indent = "  ".repeat(depth)
        val qn = cls.qualifiedName ?: cls.name ?: return
        sb.appendLine("$indent CLASS $qn")
        cls.superClass?.qualifiedName?.let { sup ->
            if (sup != "java.lang.Object") {
                sb.appendLine("$indent  extends $sup")
            }
        }
        cls.implementsList?.referencedTypes?.forEach { t ->
            val name = t.canonicalText
            if (name.isNotEmpty()) {
                sb.appendLine("$indent  implements $name")
            }
        }
        for (field in cls.fields) {
            sb.appendLine("$indent  PROPERTY ${field.type.presentableText} ${field.name}")
        }
        for (m in cls.methods) {
            if (m.isConstructor) continue
            sb.appendLine("$indent  METHOD ${formatJavaMethod(m)}")
        }
        for (inner in cls.innerClasses) {
            appendJavaClass(sb, inner, depth + 1)
        }
    }

    private fun formatJavaMethod(m: PsiMethod): String {
        val ret = m.returnType?.presentableText ?: "void"
        val params = m.parameterList.parameters.joinToString(", ") { p ->
            "${p.type.presentableText} ${p.name}"
        }
        return "$ret ${m.name}($params)"
    }
}
