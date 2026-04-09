package com.localllm.intellij

import com.intellij.openapi.fileEditor.impl.LoadTextUtil
import com.intellij.openapi.module.Module
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiClass
import com.intellij.psi.PsiClassType
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiJavaFile
import com.intellij.psi.PsiManager
import com.intellij.psi.PsiMethod

/**
 * Extracts a **domain vocabulary** from the same Java/Kotlin sources scanned for the knowledge graph,
 * then **groups** terms into coarse **domain** buckets (typically the first two package segments).
 * Also derives recurring **CamelCase words** per domain as a lightweight ubiquitous-language hint.
 *
 * Optionally merges symbols from **attached files** (paths / names) into an "Attached context" group.
 */
object DomainVocabularyCollector {

    private const val MAX_FILES = 180
    private const val MAX_TERMS_PER_CATEGORY = 400

    private val KT_TYPE_DECL = Regex(
        """^(?:@[\w.]+\s+)*(?:(?:data|sealed|inner|abstract|open|private|internal|protected|public|final)\s+)*(?:enum\s+)?(class|interface|object)\s+(\w+)(?:\s*:\s*([^({]+))?"""
    )
    private val KT_FUN = Regex(
        """^(?:@[\w.]+\s+)*(?:private|internal|protected|public|override|suspend\s+)*fun\s+(?:[\w.`]+\.)?(\w+)\s*[\(<]"""
    )

    data class VocabularyReport(val markdown: String, val coarseDomainCount: Int, val packageCount: Int)

    /**
     * @param attachedFiles optional files the user attached in the tool window (names / paths only).
     */
    fun collect(project: Project, indicator: ProgressIndicator?, attachedFiles: List<VirtualFile>): VocabularyReport {
        val byPackage = LinkedHashMap<String, PackageBucket>()
        val coarseToPackages = LinkedHashMap<String, LinkedHashSet<String>>()

        var fileCount = 0
        var truncated = false
        val psiManager = PsiManager.getInstance(project)
        val modules = ModuleManager.getInstance(project).modules

        outer@ for (module in modules) {
            indicator?.checkCanceled()
            val roots = ModuleRootManager.getInstance(module).sourceRoots
            for (root in roots) {
                VfsUtilCore.iterateChildrenRecursively(root, null) { file: VirtualFile ->
                    indicator?.checkCanceled()
                    if (fileCount >= MAX_FILES) {
                        truncated = true
                        return@iterateChildrenRecursively false
                    }
                    if (file.isDirectory) return@iterateChildrenRecursively true
                    when {
                        file.name.endsWith(".java") -> {
                            val psi = psiManager.findFile(file) as? PsiJavaFile
                                ?: return@iterateChildrenRecursively true
                            ingestJavaFile(module, psi, byPackage, coarseToPackages)
                            fileCount++
                        }
                        file.name.endsWith(".kt") -> {
                            val text = loadKotlinText(file, psiManager)
                            ingestKotlinFile(module, file, text, byPackage, coarseToPackages)
                            fileCount++
                        }
                    }
                    true
                }
                if (truncated) break@outer
            }
        }

        ingestAttachments(project, attachedFiles, byPackage, coarseToPackages)

        val md = buildMarkdown(project.name, byPackage, coarseToPackages, truncated)
        return VocabularyReport(
            markdown = md,
            coarseDomainCount = coarseToPackages.size,
            packageCount = byPackage.size
        )
    }

    private class PackageBucket {
        val types = LinkedHashSet<String>()
        val methods = LinkedHashSet<String>()
        val properties = LinkedHashSet<String>()
        val modules = LinkedHashSet<String>()
    }

    private fun bucketForPackage(byPackage: LinkedHashMap<String, PackageBucket>, pkg: String): PackageBucket {
        val key = pkg.ifBlank { "(default package)" }
        return byPackage.getOrPut(key) { PackageBucket() }
    }

    private fun registerCoarse(coarseToPackages: LinkedHashMap<String, LinkedHashSet<String>>, pkg: String) {
        val coarse = coarseDomainKey(pkg)
        coarseToPackages.getOrPut(coarse) { LinkedHashSet() }.add(pkg.ifBlank { "(default package)" })
    }

    /** Coarse domain group: first two package segments (e.g. `com.example`), or full short packages. */
    private fun coarseDomainKey(packageName: String): String {
        val p = packageName.trim()
        if (p.isEmpty()) return "(default package)"
        val parts = p.split('.').filter { it.isNotEmpty() }
        return when {
            parts.size <= 2 -> p
            else -> parts.take(2).joinToString(".")
        }
    }

    private fun ingestJavaFile(
        module: Module,
        psi: PsiJavaFile,
        byPackage: LinkedHashMap<String, PackageBucket>,
        coarseToPackages: LinkedHashMap<String, LinkedHashSet<String>>
    ) {
        val pkg = psi.packageName ?: ""
        registerCoarse(coarseToPackages, pkg)
        val b = bucketForPackage(byPackage, pkg)
        b.modules.add(module.name)
        for (cls in psi.classes) {
            ingestJavaClass(cls, b)
        }
    }

    private fun ingestJavaClass(cls: PsiClass, b: PackageBucket) {
        val simple = cls.name ?: return
        capAdd(b.types, simple)

        cls.superClass?.name?.let { sup ->
            if (sup != "Object") capAdd(b.types, sup)
        }
        cls.implementsList?.referencedTypes?.forEach { t ->
            when (t) {
                is PsiClassType -> t.resolve()?.name?.let { capAdd(b.types, it) }
                else -> {
                    val raw = t.presentableText.substringBefore('<').trim().substringAfterLast('.')
                    if (raw.isNotEmpty() && raw[0].isUpperCase()) capAdd(b.types, raw)
                }
            }
        }
        for (field in cls.fields) {
            val fn = field.name ?: continue
            capAdd(b.properties, fn)
        }
        for (m in cls.methods) {
            if (m.isConstructor) continue
            val mn = m.name ?: continue
            capAdd(b.methods, mn)
        }
        for (inner in cls.innerClasses) {
            ingestJavaClass(inner, b)
        }
    }

    private fun ingestKotlinFile(
        module: Module,
        file: VirtualFile,
        text: String?,
        byPackage: LinkedHashMap<String, PackageBucket>,
        coarseToPackages: LinkedHashMap<String, LinkedHashSet<String>>
    ) {
        if (text.isNullOrBlank()) return
        val declared = Regex("""^package\s+([^\s;]+)""", RegexOption.MULTILINE).find(text)?.groupValues?.getOrNull(1)?.trim() ?: ""
        val pkg = declared
        registerCoarse(coarseToPackages, pkg)
        bucketForPackage(byPackage, pkg).modules.add(module.name)
        for (raw in text.lines()) {
            val line = raw.trim()
            if (line.startsWith("package ")) continue
            if (line.isEmpty() || line.startsWith("//") || line.startsWith("import ")) continue
            val b = bucketForPackage(byPackage, pkg)
            KT_TYPE_DECL.find(line)?.let { m ->
                capAdd(b.types, m.groupValues[2])
            }
            KT_FUN.find(line)?.let { m ->
                capAdd(b.methods, m.groupValues[1])
            }
        }
    }

    private fun ingestAttachments(
        project: Project,
        attached: List<VirtualFile>,
        byPackage: LinkedHashMap<String, PackageBucket>,
        coarseToPackages: LinkedHashMap<String, LinkedHashSet<String>>
    ) {
        if (attached.isEmpty()) return
        val pkg = "(attached context)"
        registerCoarse(coarseToPackages, pkg)
        val b = bucketForPackage(byPackage, pkg)
        b.modules.add(project.name)
        val base = project.basePath
        for (vf in attached) {
            val rel = if (base != null && vf.path.startsWith(base)) {
                vf.path.substring(base.length).trimStart('/', '\\')
            } else {
                vf.path
            }
            capAdd(b.types, vf.nameWithoutExtension)
            capAdd(b.methods, rel.replace('\\', '/'))
        }
    }

    private fun loadKotlinText(file: VirtualFile, psiManager: PsiManager): String? {
        val psi: PsiFile? = psiManager.findFile(file)
        val fromPsi = psi?.text
        if (!fromPsi.isNullOrBlank()) return fromPsi
        return runCatching { LoadTextUtil.loadText(file).toString() }.getOrNull()
    }

    private fun capAdd(set: LinkedHashSet<String>, value: String) {
        if (set.size >= MAX_TERMS_PER_CATEGORY) return
        val v = value.trim()
        if (v.isNotEmpty()) set.add(v)
    }

    /** Split CamelCase / PascalCase into word fragments (lower case). */
    private fun camelWords(identifier: String): List<String> {
        if (identifier.isEmpty()) return emptyList()
        val parts = identifier.split(Regex("(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])"))
            .map { it.lowercase() }
            .filter { it.length >= 2 }
        return parts.distinct()
    }

    private fun buildMarkdown(
        projectName: String,
        byPackage: LinkedHashMap<String, PackageBucket>,
        coarseToPackages: LinkedHashMap<String, LinkedHashSet<String>>,
        truncated: Boolean
    ): String = buildString {
        appendLine("# Domain vocabulary")
        appendLine()
        appendLine("Project: **$projectName**")
        appendLine()
        appendLine("Terms are gathered from **Java PSI** and **Kotlin source text** (same scan limits as the knowledge graph).")
        appendLine("**Domain groups** use the first **two** package segments (e.g. `com.example`); each section lists **packages** inside that domain.")
        appendLine()
        appendLine("---")
        appendLine()

        val sortedCoarse = coarseToPackages.keys.sortedWith(compareBy { it.lowercase() })
        for (coarse in sortedCoarse) {
            val packagesInCoarse = coarseToPackages[coarse]?.sortedWith(compareBy { it.lowercase() }) ?: continue
            appendLine("## Domain: `$coarse`")
            appendLine()
            for (pkg in packagesInCoarse) {
                val b = byPackage[pkg] ?: continue
                appendLine("### Package: `$pkg`")
                if (b.modules.isNotEmpty()) {
                    appendLine("*Modules:* ${b.modules.sorted().distinct().joinToString(", ")}")
                }
                appendLine()
                appendTermList("Types (classes / interfaces / objects / type refs)", b.types)
                appendTermList("Methods / functions", b.methods)
                appendTermList("Properties / fields", b.properties)
                val glossary = LinkedHashSet<String>()
                for (t in b.types) {
                    if ('/' !in t && '\\' !in t) camelWords(t).forEach { glossary.add(it) }
                }
                for (m in b.methods) {
                    if ('/' !in m && '\\' !in m) camelWords(m).forEach { glossary.add(it) }
                }
                glossary.removeAll(setOf("get", "set", "is", "to", "of", "on", "in", "at"))
                if (glossary.isNotEmpty()) {
                    appendLine("**Derived words (CamelCase split):** ${glossary.sorted().joinToString(", ")}")
                    appendLine()
                }
                appendLine()
            }
            appendLine("---")
            appendLine()
        }

        if (truncated) {
            appendLine("*Scan stopped at file limit ($MAX_FILES); vocabulary may be incomplete.*")
        }
    }

    private fun StringBuilder.appendTermList(title: String, set: LinkedHashSet<String>) {
        if (set.isEmpty()) return
        val list = set.sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it })
        appendLine("**$title:** ${list.joinToString(", ")}")
        appendLine()
    }
}
