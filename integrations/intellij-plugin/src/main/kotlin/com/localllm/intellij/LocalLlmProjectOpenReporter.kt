package com.localllm.intellij

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

/**
 * Fires once after a project is opened so the desktop app can register [Project.basePath] in the codebase catalog
 * without depending on chat traffic.
 */
class LocalLlmProjectOpenReporter : ProjectActivity {
    override suspend fun execute(project: Project) {
        if (project.isDisposed) return
        LocalLlmPluginReports.postAsync(project, PluginReportKind.WORKSPACE_SEEN, null, emptyMap())
    }
}
