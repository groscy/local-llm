package com.localllm.intellij

import com.google.gson.JsonObject
import com.intellij.openapi.project.Project

/** Read-only or mutating tool invoked by [AgentOrchestrator]. */
interface AgentTool {
    val name: String
    val description: String

    /**
     * Runs under read-action or write-action as appropriate; keep fast and bounded.
     * @return human-readable result or error line for the model transcript
     */
    fun execute(project: Project, args: JsonObject): String
}
