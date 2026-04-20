import { createHash } from 'crypto'
import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import {
  FORMAL_LLM_ADVISORY_DISCLAIMER,
  type CodebaseRecord,
  type FormalToolProfile,
  type FormalVerificationRun,
  type FormalVerificationRunLlmAdvisory
} from '@shared/codebaseRegistry'
import { resolveChatMaxCompletionTokens } from './chatMaxTokens'
import { searchKbHits } from './kbService'
import { scanArchitectureRepository } from './architectureRepositoryScan'
import type { RuntimeAdapter, ChatMessage } from './runtime/types'

const MAX_STD_IN_PROMPT = 12_000
const MAX_KB_BLOCK = 2_400
const MAX_SCAN_JSON = 1_800
const INTERPRET_MAX_NEW_TOKENS = 2048

export function truncateForInterpret(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max - 20)}\n…[truncated]`
}

function kbContextBlock(db: Database.Database, codebase: CodebaseRecord): string {
  const parts: string[] = []
  const q = [codebase.displayName, codebase.linkedIdeProjectName, codebase.rootPath.split('/').pop()]
    .filter(Boolean)
    .join(' ')
    .trim()
  if (!q) return ''
  const hits = searchKbHits(db, q, 5)
  let used = 0
  for (const h of hits) {
    const line = `- ${h.sourceTitle}${h.heading ? ` — ${h.heading}` : ''}: ${h.snippet}\n`
    if (used + line.length > MAX_KB_BLOCK) break
    parts.push(line)
    used += line.length
  }
  if (parts.length === 0) return ''
  return `## Knowledge base snippets (may be irrelevant; cite cautiously)\n${parts.join('')}`
}

function scanSummaryBlock(rootPath: string): string {
  try {
    const r = scanArchitectureRepository(rootPath)
    const summary = {
      root: r.root,
      fileCount: r.fileCount,
      truncated: r.truncated,
      topExtensions: Object.entries(r.extensions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 16)
        .map(([ext, n]) => `${ext}:${n}`)
    }
    const raw = JSON.stringify(summary)
    return truncateForInterpret(raw, MAX_SCAN_JSON)
  } catch {
    return ''
  }
}

export function buildFormalInterpretPromptParts(p: {
  run: FormalVerificationRun
  profileLabel: string
  codebase: CodebaseRecord
  kbBlock: string
  scanBlock: string
}): { system: string; user: string; promptHash: string } {
  const system = `You are assisting a software engineer who ran an external formal verification or check command on their machine.
You are NOT a theorem prover and you do NOT replace the tool's verdict.
Rules:
- Treat the tool exit code and log excerpts below as authoritative for pass/fail of that command.
- Summarize what likely happened, list concrete next debugging steps, and call out uncertainty.
- Do not invent exit codes, file paths, or tool output that are not present in the excerpt.
- Use short sections with headings. Prefer under 800 words.`

  const userParts = [
    `## Profile\n${p.profileLabel}`,
    `## Codebase\n${p.codebase.rootPath}${p.codebase.displayName ? `\nDisplay name: ${p.codebase.displayName}` : ''}`,
    `## Command\n${truncateForInterpret(p.run.commandResolved, 4000)}`,
    `## Tool status\nstatus=${p.run.status} exitCode=${p.run.exitCode === null ? 'null' : String(p.run.exitCode)}`,
    `## stdout (excerpt)\n\`\`\`\n${truncateForInterpret(p.run.stdout, MAX_STD_IN_PROMPT)}\n\`\`\``,
    `## stderr (excerpt)\n\`\`\`\n${truncateForInterpret(p.run.stderr, MAX_STD_IN_PROMPT)}\n\`\`\``
  ]
  if (p.kbBlock) userParts.push(p.kbBlock)
  if (p.scanBlock) userParts.push(`## Repository scan summary (bounded)\n\`\`\`json\n${p.scanBlock}\n\`\`\``)

  const user = userParts.join('\n\n')
  const promptHash = createHash('sha256').update(`${system}\n${user}`).digest('hex')
  return { system, user, promptHash }
}

export function shouldAutoInterpretFormalRun(
  store: Store<Record<string, unknown>>,
  profile: FormalToolProfile
): boolean {
  if (profile.interpretWithLlm === true) return true
  if (profile.interpretWithLlm === false) return false
  return store.get('formalVerificationInterpretWithLlm') === true
}

export function shouldIncludeKbContext(store: Store<Record<string, unknown>>): boolean {
  return store.get('formalVerificationInterpretIncludeKb') === true
}

export async function attachFormalRunLlmAdvisory(p: {
  store: Store<Record<string, unknown>>
  db: Database.Database
  getRuntime: () => RuntimeAdapter | null
  run: FormalVerificationRun
  profile: FormalToolProfile
  codebase: CodebaseRecord
  /** When true, attach KB snippets + bounded repo scan JSON to the prompt. */
  includeContext: boolean
}): Promise<FormalVerificationRun> {
  const rt = p.getRuntime()
  const st = rt?.getStatus()
  if (!rt || !st?.running) {
    return {
      ...p.run,
      llmAdvisoryError: 'Local model runtime is not running. Start a model under Run, then try again.'
    }
  }

  const kbBlock = p.includeContext ? kbContextBlock(p.db, p.codebase) : ''
  const scanBlock = p.includeContext ? scanSummaryBlock(p.codebase.rootPath) : ''
  const { system, user, promptHash } = buildFormalInterpretPromptParts({
    run: p.run,
    profileLabel: p.profile.label,
    codebase: p.codebase,
    kbBlock,
    scanBlock
  })

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ]

  const maxTokens = resolveChatMaxCompletionTokens(
    p.store,
    INTERPRET_MAX_NEW_TOKENS,
    st.kind === 'llamacpp' ? 'llamacpp' : st.kind === 'ollama' ? 'ollama' : undefined
  )

  try {
    const text = await rt.chat(messages, {
      maxTokens,
      temperature: 0.2,
      topP: 0.9,
      frequencyPenalty: 0,
      presencePenalty: 0
    })
    const trimmed = text.trim().slice(0, 48_000)
    const advisory: FormalVerificationRunLlmAdvisory = {
      text: trimmed,
      createdAt: Date.now(),
      promptHash,
      disclaimer: FORMAL_LLM_ADVISORY_DISCLAIMER
    }
    return { ...p.run, llmAdvisory: advisory, llmAdvisoryError: undefined }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ...p.run, llmAdvisoryError: msg.slice(0, 2000) }
  }
}
