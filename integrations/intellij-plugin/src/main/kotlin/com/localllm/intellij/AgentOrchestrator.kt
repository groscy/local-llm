package com.localllm.intellij

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.runReadAction
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import java.io.IOException
import java.util.concurrent.atomic.AtomicInteger

/**
 * Multi-step agent: POST /v1/chat in a loop, parse JSON tool protocol, execute [AgentToolRegistry] tools, feed back.
 */
object AgentOrchestrator {

    private const val DEFAULT_MAX_STEPS = 14
    private const val MAX_PARSE_RETRIES = 1
    private const val WALL_MS = 12 * 60_000L

    fun run(
        project: Project,
        userGoal: String,
        referencedFiles: List<VirtualFile>,
        applyStructuredEdits: Boolean,
        indicator: ProgressIndicator,
        port: Int,
        token: String,
        onLog: (String) -> Unit,
        notifyDesktop: (kind: String, message: String?, meta: Map<String, Any?>) -> Unit,
        onFinished: (success: Boolean) -> Unit
    ) {
        val messages = mutableListOf<LocalLlmHttpClient.ChatMessage>()
        messages.add(LocalLlmHttpClient.ChatMessage("system", LocalLlmAgentSystemPrompts.build(AgentToolRegistry.toolNamesForPrompt())))
        messages.add(LocalLlmHttpClient.ChatMessage("user", userGoal.trim()))

        val stepCounter = AtomicInteger(0)
        val deadline = System.currentTimeMillis() + WALL_MS
        var stopReason = "unknown"

        try {
            agentLoop@ while (stepCounter.incrementAndGet() <= DEFAULT_MAX_STEPS) {
                indicator.checkCanceled()
                if (System.currentTimeMillis() > deadline) {
                    stopReason = "time_budget"
                    onLog("(Agent stopped: time budget exceeded.)\n\n")
                    break@agentLoop
                }
                indicator.text = "Agent step ${stepCounter.get()}/$DEFAULT_MAX_STEPS…"

                var parsed: AgentJsonProtocol.Parsed = AgentJsonProtocol.Parsed.Invalid("no reply")
                var rawReply = ""
                parseRetry@ for (attempt in 0..MAX_PARSE_RETRIES) {
                    indicator.checkCanceled()
                    val completion = try {
                        LocalLlmHttpClient.chat(port, token, messages)
                    } catch (e: LocalLlmHttpClient.LocalLlmHttpException) {
                        notifyDesktop(PluginReportKind.CHAT_FAILED, "HTTP ${e.status}", mapOf("project" to project.name))
                        onLog("HTTP ${e.status}: ${e.body.take(400)}\n\n")
                        stopReason = "http_error"
                        onFinished(false)
                        return
                    } catch (e: IOException) {
                        notifyDesktop(PluginReportKind.CHAT_FAILED, e.message?.take(200), mapOf("project" to project.name))
                        onLog("Network: ${e.message}\n\n")
                        stopReason = "io_error"
                        onFinished(false)
                        return
                    }
                    rawReply = completion.reply.trim()
                    parsed = AgentJsonProtocol.parseAssistantMessage(rawReply)
                    if (parsed !is AgentJsonProtocol.Parsed.Invalid) break@parseRetry
                    if (attempt == MAX_PARSE_RETRIES) break@parseRetry
                    val err = (parsed as AgentJsonProtocol.Parsed.Invalid).reason
                    onLog("(Agent: invalid JSON — retrying once: $err)\n\n")
                    messages.add(LocalLlmHttpClient.ChatMessage("assistant", rawReply))
                    messages.add(
                        LocalLlmHttpClient.ChatMessage(
                            "user",
                            "That reply was not valid agent JSON. Output exactly one JSON object with schemaVersion 1 and kind tool_calls or done. Parser said: $err"
                        )
                    )
                }

                when (parsed) {
                    is AgentJsonProtocol.Parsed.Invalid -> {
                        onLog("(Agent stopped: ${parsed.reason})\n\n")
                        stopReason = "parse_error"
                        break@agentLoop
                    }
                    is AgentJsonProtocol.Parsed.Done -> {
                        onLog("Agent done: ${parsed.summary}\n\n")
                        if (parsed.finalReply.isNotBlank()) {
                            onLog("${parsed.finalReply}\n\n")
                        }
                        stopReason = "done"
                        val replyForApply = parsed.finalReply.ifBlank { rawReply }
                        finishAgent(
                            project = project,
                            applyStructuredEdits = applyStructuredEdits,
                            replyForApply = replyForApply,
                            referencedFiles = referencedFiles,
                            onLog = onLog,
                            notifyDesktop = notifyDesktop,
                            stepCounter = stepCounter.get(),
                            stopReason = stopReason,
                            summary = parsed.summary,
                            onFinished = onFinished
                        )
                        return
                    }
                    is AgentJsonProtocol.Parsed.ToolCalls -> {
                        messages.add(LocalLlmHttpClient.ChatMessage("assistant", rawReply))
                        onLog("Agent tools: ${parsed.calls.joinToString { it.name }}\n")

                        val results = runReadAction<List<Pair<AgentJsonProtocol.ToolCall, String>>> {
                            parsed.calls.map { call ->
                                call to AgentToolRegistry.execute(project, call.name, call.args)
                            }
                        }

                        for ((call, out) in results) {
                            val preview = if (out.length > 6000) out.take(6000) + "\n… [truncated]" else out
                            val first = preview.lineSequence().firstOrNull()?.take(120).orEmpty()
                            onLog("  · ${call.name}: $first… (${out.length} chars)\n")
                        }
                        onLog("\n")

                        notifyDesktop(
                            PluginReportKind.AGENT_STEP,
                            "step ${stepCounter.get()}",
                            mapOf(
                                "project" to project.name,
                                "tools" to parsed.calls.joinToString(",") { it.name },
                                "step" to stepCounter.get()
                            )
                        )

                        val userFollowUp = AgentJsonProtocol.formatToolResultsForUser(stepCounter.get(), results)
                        messages.add(LocalLlmHttpClient.ChatMessage("user", userFollowUp))
                    }
                }
            }
            if (stepCounter.get() > DEFAULT_MAX_STEPS) {
                stopReason = "max_steps"
                onLog("(Agent stopped: max steps $DEFAULT_MAX_STEPS.)\n\n")
            }
            notifyDesktop(
                PluginReportKind.AGENT_STOP,
                stopReason,
                mapOf("project" to project.name, "steps" to stepCounter.get(), "reason" to stopReason)
            )
            AgentSessionStore.save(
                AgentSessionStore.Snapshot(
                    endedAtEpochMs = System.currentTimeMillis(),
                    steps = stepCounter.get(),
                    stopReason = stopReason,
                    summary = ""
                )
            )
            onFinished(stopReason == "done")
        } catch (_: ProcessCanceledException) {
            notifyDesktop(PluginReportKind.SEND_CANCELLED, "agent_cancelled", mapOf("project" to project.name))
            onLog("(Agent cancelled.)\n\n")
            onFinished(false)
        }
    }

    private fun finishAgent(
        project: Project,
        applyStructuredEdits: Boolean,
        replyForApply: String,
        referencedFiles: List<VirtualFile>,
        onLog: (String) -> Unit,
        notifyDesktop: (kind: String, message: String?, meta: Map<String, Any?>) -> Unit,
        stepCounter: Int,
        stopReason: String,
        summary: String,
        onFinished: (Boolean) -> Unit
    ) {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) {
                onFinished(false)
                return@invokeLater
            }
            LocalLlmApplyCoordinator.applyEditsIfAny(
                project = project,
                applyEnabled = applyStructuredEdits,
                modelReply = replyForApply,
                referencedFiles = referencedFiles,
                appendTranscript = onLog,
                appendTranscriptSection = { title, body -> onLog("$title\n$body\n\n") },
                notifyDesktop = notifyDesktop,
                onComplete = {
                    notifyDesktop(
                        PluginReportKind.AGENT_STOP,
                        stopReason,
                        mapOf(
                            "project" to project.name,
                            "steps" to stepCounter,
                            "reason" to stopReason
                        )
                    )
                    AgentSessionStore.save(
                        AgentSessionStore.Snapshot(
                            endedAtEpochMs = System.currentTimeMillis(),
                            steps = stepCounter,
                            stopReason = stopReason,
                            summary = summary
                        )
                    )
                    onFinished(true)
                }
            )
        }
    }
}
