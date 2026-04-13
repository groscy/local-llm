package com.localllm.intellij

/**
 * Values allowed for `POST /v1/plugin/report` body field `kind`.
 * Must match `pluginReportBodySchema` in the desktop `integrationServer.ts`.
 */
object PluginReportKind {
    const val CHAT_COMPLETED = "chat_completed"
    const val CHAT_FAILED = "chat_failed"
    const val APPLY_COMPLETED = "apply_completed"
    const val APPLY_FAILED = "apply_failed"
    const val APPLY_CANCELLED = "apply_cancelled"
    const val SEND_CANCELLED = "send_cancelled"
}
