import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import { llamaSamplingFromStore } from './llamaChatOptions'
import { resolveChatMaxCompletionTokens } from './chatMaxTokens'
import * as kbService from './kbService'
import { fetchApprovedUrl } from './deepLearnFetch'
import type { RuntimeAdapter } from './runtime/types'
import { WIKI_REFERENCE_SECTION_MARKDOWN } from '@shared/wikiArticleExtras'

const DEEP_LEARN_SYSTEM = `You expand a **personal reference article** for the user's local knowledge base (offline-first). Write neutral, third-person prose suitable for future lookup — not a chat recap.

You MUST reply using **exactly** this structure (no text before the first tag):

<deep-learn-status>continue</deep-learn-status> OR <deep-learn-status>done</deep-learn-status>

Use **done** only when the article covers the topic well enough that a curious reader would not miss major obvious facets (scope, history, key terms, caveats if any).

Then:

<deep-learn-body>
Markdown body using **this section order**:

::: glossary
**MAIN_TERM** — One-line definition (MAIN_TERM should match the topic).
:::

${WIKI_REFERENCE_SECTION_MARKDOWN.practice}

How the concept shows up in practice: typical contexts, who it matters to, operational defaults.

${WIKI_REFERENCE_SECTION_MARKDOWN.related}

Named ties to other concepts (synonyms, contrasts, dependencies, related fields). Bullets like "- **OtherTerm** — brief relation."

${WIKI_REFERENCE_SECTION_MARKDOWN.notes}

Longer detail, examples, edge cases. If remote excerpts were provided, ground claims in them when relevant and name the URL once.

</deep-learn-body>

Rules:
- Prefer accurate, neutral prose. If you speculate, prefix with "Possibly:".
- Do not wrap the entire reply in an outer code fence.
- Each round, **improve the full article** inside <deep-learn-body>; do not answer with only a tiny delta unless the draft is already long — then add new subsections instead of repeating.

After </deep-learn-body>, add **exactly**:

<deep-learn-explore>
Markdown bullet list of **3–5** concrete follow-up research angles the user might want next. Each bullet must be:
- **Short label** — one clause describing what to dig into next (subtopic, comparison, history, tooling, controversy, etc.).
Use real noun phrases; keep each line under 160 characters.
</deep-learn-explore>`

const cancelledJobs = new Set<string>()

export type DeepLearnExplorePath = { label: string; prompt: string }

export type DeepLearnRoundChoice =
  | { action: 'continue'; followUp?: string }
  | { action: 'finish' }
  | { action: 'cancel' }

type RoundWait = { resolve: (c: DeepLearnRoundChoice) => void }
const roundChoiceWaiters = new Map<string, RoundWait>()

export function resolveDeepLearnRoundChoice(jobId: string, choice: DeepLearnRoundChoice): void {
  const w = roundChoiceWaiters.get(jobId)
  if (!w) return
  roundChoiceWaiters.delete(jobId)
  w.resolve(choice)
}

function waitForDeepLearnRoundChoice(jobId: string): Promise<DeepLearnRoundChoice> {
  return new Promise((resolve) => {
    roundChoiceWaiters.set(jobId, { resolve })
  })
}

export function deepLearnCancelJob(jobId: string): void {
  cancelledJobs.add(jobId)
  resolveDeepLearnRoundChoice(jobId, { action: 'cancel' })
}

function isCancelled(jobId: string): boolean {
  return cancelledJobs.has(jobId)
}

export type DeepLearnProgressSender = (payload: {
  kind: 'fetch' | 'round' | 'ingest' | 'roundAwaitChoice'
  url?: string
  round?: number
  maxRounds?: number
  roundCompleted?: number
  explorePaths?: DeepLearnExplorePath[]
  canContinueMore?: boolean
  modelSuggestsDone?: boolean
}) => void

export type RunDeepLearnArgs = {
  db: Database.Database
  store: Store<Record<string, unknown>>
  rt: RuntimeAdapter
  jobId: string
  conversationId: string
  subject: string
  userMessage: string
  /** Exact URLs the user approved in the UI (subset of candidates). */
  approvedFetchUrls: string[]
  maxRounds: number
  maxFetchBytes: number
  sendProgress: DeepLearnProgressSender
}

function parseResearchRound(raw: string): { status: 'done' | 'continue'; body: string } {
  const text = raw.replace(/\r\n/g, '\n')
  const statusM = text.match(/<deep-learn-status>\s*(done|continue)\s*<\/deep-learn-status>/i)
  const status = statusM?.[1]?.toLowerCase() === 'done' ? 'done' : 'continue'
  const bodyM = text.match(/<deep-learn-body>([\s\S]*?)<\/deep-learn-body>/i)
  const body = (bodyM?.[1] ?? '').trim()
  return { status, body }
}

/** Parse suggested follow-up bullets from the model reply. */
export function parseDeepLearnExplorePaths(raw: string): DeepLearnExplorePath[] {
  const text = raw.replace(/\r\n/g, '\n')
  const m = text.match(/<deep-learn-explore>([\s\S]*?)<\/deep-learn-explore>/i)
  if (!m) return []
  const block = m[1]
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s+/.test(l) || /^\d+[.)]\s+/.test(l))
  const out: DeepLearnExplorePath[] = []
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '').trim()
    const bold = cleaned.match(/^\*\*([^*]+)\*\*\s*[—:–-]\s*(.+)$/i)
    if (bold) {
      const label = bold[1].trim().slice(0, 120)
      const prompt = bold[2].trim().slice(0, 400)
      if (label.length >= 2 && prompt.length >= 4) {
        out.push({ label, prompt })
      }
      continue
    }
    if (cleaned.length >= 8) {
      const label = cleaned.slice(0, 80)
      out.push({ label, prompt: cleaned.slice(0, 400) })
    }
    if (out.length >= 6) break
  }
  return out.slice(0, 5)
}

function buildUserPromptRound1(subject: string, userMessage: string, fetchedBlock: string): string {
  return [
    `Topic (canonical title): ${subject}`,
    '',
    'Original user message:',
    userMessage,
    '',
    fetchedBlock ? '--- Approved remote excerpts (may be partial) ---\n\n' + fetchedBlock : '(No remote URLs were fetched for this run.)',
    '',
    'Write the first strong version of the wiki article (all sections).'
  ].join('\n')
}

function buildUserPromptFollowUp(
  subject: string,
  userMessage: string,
  fetchedBlock: string,
  previousBody: string,
  round: number,
  maxRounds: number,
  userChosenFocus: string
): string {
  const focus =
    userChosenFocus.trim().length > 0
      ? [
          '',
          '--- User-selected investigation angle for this round (prioritize this) ---',
          userChosenFocus.trim()
        ].join('\n')
      : ''
  return [
    `Topic: ${subject}`,
    '',
    'Original user message:',
    userMessage,
    '',
    fetchedBlock ? '--- Remote excerpts ---\n\n' + fetchedBlock : '',
    focus,
    '',
    `Refinement round ${round} of ${maxRounds}. Improve the draft below: fix gaps, tighten wording, add missing subtopics. Keep the same Markdown section structure.`,
    '',
    '--- Current draft ---',
    previousBody
  ].join('\n')
}

/**
 * Multi-round local model pass + optional URL fetches + single KB ingest.
 */
export async function runDeepLearnResearch(args: RunDeepLearnArgs): Promise<{
  sourceId: string
  title: string
  roundsUsed: number
  fetchErrors: string[]
  lastExplorePaths: DeepLearnExplorePath[]
}> {
  const {
    db,
    store,
    rt,
    jobId,
    conversationId,
    subject,
    userMessage,
    approvedFetchUrls,
    maxRounds,
    maxFetchBytes,
    sendProgress
  } = args

  const st = rt.getStatus()
  const runtimeKind = st.kind === 'ollama' ? 'ollama' : st.kind === 'llamacpp' ? 'llamacpp' : undefined
  const perRoundTokens = Math.min(
    4096,
    Math.max(512, resolveChatMaxCompletionTokens(store, undefined, runtimeKind))
  )

  const sampling =
    st.kind === 'llamacpp'
      ? llamaSamplingFromStore(store)
      : { temperature: 0.45, topP: 0.9, frequencyPenalty: 0, presencePenalty: 0 }

  const fetchErrors: string[] = []
  const fetchParts: string[] = []
  const ac = new AbortController()

  try {
    for (const url of approvedFetchUrls) {
      if (isCancelled(jobId)) {
        throw new Error('cancelled')
      }
      sendProgress({ kind: 'fetch', url })
      try {
        const text = await fetchApprovedUrl(url, {
          maxBytes: maxFetchBytes,
          timeoutMs: 25_000,
          signal: ac.signal
        })
        fetchParts.push(`### Source: ${url}\n\n${text}`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        fetchErrors.push(`${url} — ${msg}`)
      }
    }

    const fetchedBlock = fetchParts.join('\n\n---\n\n')
    let draft = ''
    let roundsUsed = 0
    const cap = Math.max(1, Math.min(maxRounds, 24))
    let userChosenFocus = ''
    let lastExplorePaths: DeepLearnExplorePath[] = []

    for (let round = 1; round <= cap; round++) {
      if (isCancelled(jobId)) {
        throw new Error('cancelled')
      }
      sendProgress({ kind: 'round', round, maxRounds: cap })
      const userContent =
        round === 1
          ? buildUserPromptRound1(subject, userMessage, fetchedBlock)
          : buildUserPromptFollowUp(
              subject,
              userMessage,
              fetchedBlock,
              draft,
              round,
              cap,
              userChosenFocus
            )
      userChosenFocus = ''

      const raw = await rt.chat(
        [
          { role: 'system', content: DEEP_LEARN_SYSTEM },
          { role: 'user', content: userContent }
        ],
        {
          maxTokens: perRoundTokens,
          ...sampling
        }
      )

      const parsed = parseResearchRound(raw)
      if (parsed.body.length >= 40) {
        draft = parsed.body
      } else if (!draft) {
        draft = raw.trim().slice(0, 120_000)
      }
      roundsUsed = round

      const explorePaths = parseDeepLearnExplorePaths(raw)
      lastExplorePaths = explorePaths
      const modelSuggestsDone = parsed.status === 'done'
      const canContinueMore = round < cap

      sendProgress({
        kind: 'roundAwaitChoice',
        roundCompleted: round,
        maxRounds: cap,
        explorePaths,
        canContinueMore,
        modelSuggestsDone
      })

      const choice = await waitForDeepLearnRoundChoice(jobId)
      if (choice.action === 'cancel') {
        throw new Error('cancelled')
      }
      if (choice.action === 'finish') {
        break
      }
      if (!canContinueMore) {
        break
      }
      userChosenFocus = choice.followUp?.trim() ?? ''
    }

    if (!draft.trim()) {
      throw new Error('Model returned no usable article body')
    }

    let body = draft.trim()
    if (fetchErrors.length) {
      body +=
        '\n\n## Fetch notes\n\nSome approved URLs could not be retrieved:\n\n' +
        fetchErrors.map((e) => `- ${e}`).join('\n')
    }

    if (isCancelled(jobId)) {
      throw new Error('cancelled')
    }

    sendProgress({ kind: 'ingest' })
    const t = Date.now()
    const uri = `deep-learn:${conversationId}:${t}`
    const title = `Deep learn: ${subject}`.slice(0, 500)
    const source = kbService.ingestText(db, title, uri, body, undefined, conversationId)
    return { sourceId: source.id, title, roundsUsed, fetchErrors, lastExplorePaths }
  } finally {
    ac.abort()
    cancelledJobs.delete(jobId)
    roundChoiceWaiters.delete(jobId)
  }
}
