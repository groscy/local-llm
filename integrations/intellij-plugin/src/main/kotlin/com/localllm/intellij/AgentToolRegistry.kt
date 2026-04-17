package com.localllm.intellij

import com.google.gson.JsonObject
import com.intellij.openapi.project.Project

object AgentToolRegistry {

    private val tools: List<AgentTool> = listOf(
        ReadFileAgentTool(),
        ListDirAgentTool(),
        SearchInProjectAgentTool(),
        GetOpenFileAgentTool(),
        ReadSelectionAgentTool(),
        KnowledgeGraphAgentTool()
    )

    private val byName: Map<String, AgentTool> = tools.associateBy { it.name }

    fun all(): List<AgentTool> = tools

    fun toolNamesForPrompt(): String = tools.joinToString(", ") { it.name }

    fun execute(project: Project, name: String, args: JsonObject): String {
        val t = byName[name] ?: return "error: unknown tool \"$name\". Allowed: ${byName.keys.sorted().joinToString()}"
        return try {
            t.execute(project, args)
        } catch (e: Exception) {
            "error: ${e.javaClass.simpleName}: ${e.message?.take(500)}"
        }
    }
}
