package com.localllm.intellij

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project

object LocalLlmPluginReports {

    fun postAsync(project: Project, kind: String, message: String?, meta: Map<String, Any?> = emptyMap()) {
        val port = LocalLlmIntegrationProperties.integrationPort()
        val token = LocalLlmIntegrationProperties.integrationToken()
        val baseMeta = mapOf(
            "project" to project.name,
            "projectBasePath" to (project.basePath ?: "")
        )
        val merged = baseMeta + meta
        ApplicationManager.getApplication().executeOnPooledThread {
            LocalLlmHttpClient.postPluginReport(port, token, "intellij", kind, message, merged)
        }
    }
}
