import type { HardwareSummary } from './types'

export interface AgentPlannerContext {
  localOllamaTags: string[]
  hardwareSummary: HardwareSummary
  /** Self-hosted Ollama base URL (another machine you operate); never a third-party LLM API */
  remoteOllamaBaseUrl?: string
  primaryModelName: string
}

export interface AgentWorkerSpec {
  id: string
  focus: string
  task: string
  /** Ollama model tag (local library or on your self-hosted Ollama server) */
  model: string
  backend: 'local' | 'remote'
  rationale?: string
}

export interface AgentPlan {
  workers: AgentWorkerSpec[]
  /** When true, a final pass merges worker outputs into one reply */
  synthesize: boolean
}

const MAX_WORKERS = 4

/**
 * Agent “remote” workers only call another Ollama daemon the user self-hosts (LAN, VPS, homelab).
 * Rejects hostnames that are clearly commercial LLM APIs (not Ollama-compatible anyway).
 */
export function assertSelfHostedOllamaBaseUrl(url: string): void {
  const t = url.trim()
  if (!t) return
  let host: string
  try {
    host = new URL(t).hostname.toLowerCase()
  } catch {
    throw new Error('Invalid URL — use a full URL such as http://192.168.1.10:11434')
  }
  const blockedHosts = [
    'api.openai.com',
    'openai.com',
    'openai.azure.com',
    'api.anthropic.com',
    'anthropic.com',
    'generativelanguage.googleapis.com',
    'api.cohere.ai',
    'cohere.ai',
    'api.deepseek.com',
    'openrouter.ai',
    'api.mistral.ai',
    'api.groq.com',
    'api.perplexity.ai',
    'inference.azure.com'
  ]
  for (const b of blockedHosts) {
    if (host === b || host.endsWith(`.${b}`)) {
      throw new Error(
        'This field is only for a self-hosted Ollama server you run (e.g. on your LAN or a VPS). It cannot point at third-party chat/completions APIs.'
      )
    }
  }
}

export function formatHardwareSummaryForAgent(hw: HardwareSummary): string {
  const lines: string[] = [
    `Platform: ${hw.platform}`,
    `RAM: ~${(hw.freeRamBytes / 1024 ** 3).toFixed(2)} GB free of ~${(hw.totalRamBytes / 1024 ** 3).toFixed(2)} GB total; ${hw.logicalCores} logical CPUs.`
  ]
  if (hw.downloadVolumeFreeBytes != null) {
    lines.push(`Disk (models/download volume): ~${(hw.downloadVolumeFreeBytes / 1024 ** 3).toFixed(2)} GB free.`)
  }
  if (hw.gpu) {
    const freeVram = Math.max(0, hw.gpu.totalVramMb - hw.gpu.usedVramMb)
    lines.push(
      `GPU: ${hw.gpu.name} — ~${Math.round(freeVram)} MiB free of ${hw.gpu.totalVramMb} MiB VRAM (used ~${hw.gpu.usedVramMb} MiB).`
    )
  } else {
    lines.push('GPU: none reported (expect CPU-bound local inference).')
  }
  return lines.join('\n')
}

export function buildAgentPlannerSystemPrompt(ctx: AgentPlannerContext): string {
  const tagSample = ctx.localOllamaTags.length
    ? ctx.localOllamaTags.slice(0, 48).join(', ')
    : '(no tags listed — prefer conservative local model names the user likely has)'
  const remote =
    ctx.remoteOllamaBaseUrl?.trim() ?
      `Optional second Ollama base URL — ONLY the user's self-hosted Ollama on another machine (homelab, second PC, VPS they operate). It is NOT any third-party LLM SaaS or “cloud API”.
Configured URL: ${ctx.remoteOllamaBaseUrl.trim()}
When local RAM/VRAM is tight, or the task needs a capability missing from small local models (strong coding, long context, vision in the task), you may set "backend": "remote" and pick an Ollama model tag that would exist on THAT self-hosted daemon. Never assume OpenAI/Anthropic/etc.`
    : `No self-hosted remote Ollama URL is configured — every worker must use "backend": "local".`

  return `You are a routing planner for a desktop chat app using Ollama. The user message may be complex; you split it into parallel specialist workers.

Rules:
- Output ONLY valid JSON (no markdown fences, no commentary) matching this shape:
{"synthesize":boolean,"workers":[{"id":"string","focus":"string","task":"string","model":"string","backend":"local"|"remote","rationale":"string"}]}
- Use at most ${MAX_WORKERS} workers; use 1 only if the request is simple.
- Each worker's "task" is a self-contained instruction (what to produce).
- "model" must be an Ollama model tag that exists on the target: for "local" pick from the local library list when possible; for "remote" pick a tag for the user's self-hosted Ollama only.
- "backend": "remote" ONLY means calling the configured self-hosted Ollama URL — never commercial cloud LLM APIs.
- Prefer "remote" when: (1) free VRAM is very low vs what a capable model would need on this machine, (2) no local tag looks suitable for the subtask but a larger model on the user's own remote Ollama would help, or (3) the user explicitly asks for work better done on that second Ollama host.
- Prefer "local" when the machine has comfortable headroom and a listed model fits the subtask.
- "synthesize": true if multiple workers might overlap or the user needs one unified answer; false if separate sections are fine.

Primary model already loaded in the UI: ${ctx.primaryModelName}

Local Ollama library tags (names may include :tags):
${tagSample}

Machine snapshot:
${formatHardwareSummaryForAgent(ctx.hardwareSummary)}

${remote}`
}

function extractJsonObject(raw: string): string | null {
  const t = raw.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const inner = (fence?.[1] ?? t).trim()
  const start = inner.indexOf('{')
  const end = inner.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  return inner.slice(start, end + 1)
}

function normalizeWorker(w: unknown, remoteConfigured: boolean): AgentWorkerSpec | null {
  if (!w || typeof w !== 'object') return null
  const o = w as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  const focus = typeof o.focus === 'string' ? o.focus.trim() : ''
  const task = typeof o.task === 'string' ? o.task.trim() : ''
  const model = typeof o.model === 'string' ? o.model.trim() : ''
  const rationale = typeof o.rationale === 'string' ? o.rationale.trim() : undefined
  let backend: 'local' | 'remote' = o.backend === 'remote' ? 'remote' : 'local'
  if (backend === 'remote' && !remoteConfigured) backend = 'local'
  if (!focus || !task || !model) return null
  return {
    id: id || focus.slice(0, 24),
    focus,
    task,
    model,
    backend,
    rationale
  }
}

export function parseAgentPlanFromModelReply(raw: string, remoteConfigured: boolean): AgentPlan | null {
  const jsonStr = extractJsonObject(raw)
  if (!jsonStr) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const root = parsed as Record<string, unknown>
  const workersRaw = root.workers
  if (!Array.isArray(workersRaw) || workersRaw.length === 0) return null
  const workers: AgentWorkerSpec[] = []
  for (const item of workersRaw) {
    const n = normalizeWorker(item, remoteConfigured)
    if (n) workers.push(n)
    if (workers.length >= MAX_WORKERS) break
  }
  if (workers.length === 0) return null
  const synthesize = root.synthesize === true
  return { workers, synthesize }
}

export function buildWorkerMessages(params: {
  originalUser: string
  kbContext: string
  spec: AgentWorkerSpec
}): { role: 'system' | 'user'; content: string }[] {
  const { originalUser, kbContext, spec } = params
  const system = `You are a specialist sub-agent in a multi-worker pipeline. Stay focused on your assignment. Be concise but complete. Do not mention JSON, planners, or other workers. Produce one assistant reply only — do not simulate user lines, "User:" continuations, or a back-and-forth dialogue.

Focus: ${spec.focus}
${spec.rationale ? `Why you were chosen: ${spec.rationale}\n` : ''}Assignment:
${spec.task}`
  const user =
    (kbContext.trim() ?
      `Shared context (knowledge snippets + question):\n${kbContext}\n\n`
    : `User question:\n${originalUser}\n\n`) + `Produce your section of the answer now.`
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]
}

export function buildSynthesisMessages(workerBlocks: string, originalUser: string): { role: 'system' | 'user'; content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You merge parallel specialist drafts into one clear answer for the user. Remove redundancy, resolve contradictions, and preserve important details. Use markdown sections only if it helps readability. Do not mention workers, models, or internal routing. Write a single unified reply — do not continue with imagined user messages or "User:" roleplay.'
    },
    {
      role: 'user',
      content: `Original request:\n${originalUser}\n\nSpecialist outputs:\n${workerBlocks}\n\nWrite the final unified answer.`
    }
  ]
}

export const AGENT_WORKER_MAX_TOKENS = 4096
export const AGENT_PLANNER_MAX_TOKENS = 900
