package com.localllm.intellij

/**
 * Values allowed for `POST /v1/plugin/report` body field `kind`.
 * Must match `pluginReportBodySchema` in the desktop `integrationServer.ts`.
 */
object PluginReportKind {
    const val CHAT_JOB_QUEUED = "chat_job_queued"
    const val CHAT_COMPLETED = "chat_completed"
    const val CHAT_FAILED = "chat_failed"
    const val APPLY_COMPLETED = "apply_completed"
    const val APPLY_FAILED = "apply_failed"
    const val APPLY_CANCELLED = "apply_cancelled"
    const val SEND_CANCELLED = "send_cancelled"
    /** Agent loop executed a tool batch (must match desktop `pluginReportBodySchema`). */
    const val AGENT_STEP = "agent_step"
    /** Agent loop ended (reason in message / meta). */
    const val AGENT_STOP = "agent_stop"
    /** Project opened in the IDE (desktop may register the codebase path). */
    const val WORKSPACE_SEEN = "workspace_seen"
}
