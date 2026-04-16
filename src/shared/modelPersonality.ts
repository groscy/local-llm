/**
 * Model "profile": ambient vibe + optional first-person journal entries.
 * The assistant appends [[AMB:{...}]] and/or [[JOURNAL]]...[[/JOURNAL]] at the end of replies;
 * the UI strips them before display/storage.
 */

export type ModelPersonalityVibe = {
  warmth: number
  energy: number
  playfulness: number
  calm: number
  expressiveness: number
  hueShift: number
}

export type ModelProfileJournalEntry = {
  id: string
  createdAt: number
  text: string
}

export type ModelProfile = {
  vibe: ModelPersonalityVibe
  journal: ModelProfileJournalEntry[]
}

export const DEFAULT_MODEL_PERSONALITY: ModelPersonalityVibe = {
  warmth: 0.5,
  energy: 0.5,
  playfulness: 0.5,
  calm: 0.5,
  expressiveness: 0.5,
  hueShift: 0
}

export const MAX_MODEL_JOURNAL_ENTRIES = 280

export function defaultModelProfile(): ModelProfile {
  return { vibe: { ...DEFAULT_MODEL_PERSONALITY }, journal: [] }
}

/**
 * Use the model-profile system prompt (mood + journal markers) only when the user clearly asks
 * for a subjective / personal stance — not for ordinary tasks.
 */
export function userMessageInvitesModelPersonality(raw: string): boolean {
  const t = raw.trim().replace(/\s+/g, ' ')
  if (t.length < 14) return false
  if (/\bwhat\s+('s|is)\s+your\s+opinion\b/i.test(t)) return true
  if (/\bin\s+your\s+opinion\b/i.test(t)) return true
  if (/\b(give|share)\s+(me\s+)?your\s+opinion\b/i.test(t)) return true
  if (/\bdo\s+you\s+have\s+(an\s+)?opinion\b/i.test(t)) return true
  if (/\byour\s+opinion\s+(on|of|about)\b/i.test(t)) return true
  if (/\bwhat\s+are\s+your\s+thoughts\s+(on|of|about)\b/i.test(t)) return true
  if (/\bwhat'?s\s+your\s+take\s+(on|about)\b/i.test(t)) return true
  if (/\bwhat'?s\s+your\s+view\s+(on|of|about)\b/i.test(t)) return true
  if (/\bhow\s+do\s+you\s+feel\s+about\b/i.test(t)) return true
  return false
}

/** System message for chat requests (keep in sync with strip functions). */
export const MODEL_PROFILE_SYSTEM_PROMPT = `This app keeps a hidden "model profile" for you: (1) optional numeric mood for a soft background glow, and (2) an internal journal the user reads in a profile panel.

After everything the user should read, you may append optional blocks on separate lines (removed automatically, never mention them):

1) Background mood — JSON, keys optional, values 0–1 except hueShift (−1 to +1):
[[AMB:{"warmth":0.55,"energy":0.5,"playfulness":0.45,"calm":0.5,"expressiveness":0.6,"hueShift":0.08}]]

2) Journal — short, first person (I / me), reflecting this turn. Block form:
[[JOURNAL]]
I noticed I leaned into careful steps here.
[[/JOURNAL]]

Or one line:
[[JOURNAL:I enjoyed unpacking that idea with them.]]

Use the journal when you have a genuine in-character reflection; skip both blocks when not meaningful.

You may include images when helpful: Markdown \`![alt](https://…)\` or, for small diagrams only, \`data:image/png;base64,…\`.

Reply for a single assistant turn only. Do not continue the conversation with imagined user lines, “User:” / “Human:” roleplay, quoted prompts pretending the user typed them, or answering your own questions as if the user replied. When your answer is complete, stop.`

/** Default system prompt: neutral, factual assistant unless the user explicitly asks for opinions (separate profile prompt). */
export const CHAT_MINIMAL_SYSTEM_PROMPT = `You are a helpful assistant. Answer clearly and accurately in one reply. Use markdown when it helps readability.

Keep a neutral, professional tone. Do not adopt a character voice, diary style, or subjective persona unless the user clearly asks for your personal opinion or feelings.

You may include images when helpful: use Markdown \`![description](https://…)\` for remote URLs, or a small \`data:image/png;base64,…\` image only when the user needs an inline figure and a link is not enough.

Do not invent facts. If you lack information, say so. Do not continue with imagined user lines or roleplay. When your answer is complete, stop.`

/** Appended to the user turn when RAG snippets are present and llama “Require snippet citations” is enabled. */
export const RAG_GROUNDING_INSTRUCTION = `When answering, rely on general knowledge plus the numbered snippets above only where they apply. Cite each snippet you use with its bracket number, e.g. [1] or [2]. If the snippets do not cover the question, answer from general knowledge and do not attribute claims to snippets they do not support.`

/** @deprecated Use MODEL_PROFILE_SYSTEM_PROMPT */
export const MODEL_AMBIENCE_SYSTEM_PROMPT = MODEL_PROFILE_SYSTEM_PROMPT

const V2_PREFIX = 'modelProfile:v2:'
const V1_PREFIX = 'modelPersonality:v1:'

const JOURNAL_BLOCK_RE = /\[\[JOURNAL\]\]\s*([\s\S]*?)\s*\[\[\/JOURNAL\]\]/gi
/** Single-line; avoid ] inside the line */
const JOURNAL_LINE_RE = /\[\[JOURNAL:\s*([^\]\n]+?)\s*\]\]/gi

const MODEL_PROFILE_BLOCK_RE =
  /\[\[MODEL_PROFILE\]\]\s*([\s\S]*?)\s*\[\[\/MODEL_PROFILE\]\]/gi
const MODEL_PROFILE_LINE_RE = /\[\[MODEL_PROFILE:\s*([^\]\n]+?)\s*\]\]/gi

/** `[[AMB:…]]` even with tricky JSON; also drops unclosed `[[AMB:` tails. */
function stripAmbBlocksLoose(s: string, patches: Partial<ModelPersonalityVibe>[]): string {
  let out = s
  for (;;) {
    const idx = out.indexOf('[[AMB:')
    if (idx < 0) break
    const close = out.indexOf(']]', idx + 6)
    if (close < 0) {
      out = out.slice(0, idx).replace(/\s+\z/, '')
      break
    }
    const inner = out.slice(idx + 6, close).trim()
    try {
      const p = normalizePatch(JSON.parse(inner) as unknown)
      if (Object.keys(p).length) patches.push(p)
    } catch {
      const brace = inner.indexOf('{')
      const braceEnd = inner.lastIndexOf('}')
      if (brace >= 0 && braceEnd > brace) {
        try {
          const p = normalizePatch(JSON.parse(inner.slice(brace, braceEnd + 1)) as unknown)
          if (Object.keys(p).length) patches.push(p)
        } catch {
          /* malformed — still drop block below */
        }
      }
    }
    out = out.slice(0, idx) + out.slice(close + 2)
  }
  return out
}

/** Model “thinking” / reasoning tags that should never appear in the chat pane. */
function stripReasoningAndThinkTags(s: string): string {
  let t = s
  t = t.replace(/<\s*think\s*>[\s\S]*?<\s*\/\s*think\s*>/gi, '')
  /* Qwen-style “think” tags embed U+200D between “t” and “h” */
  const zwj = '\u200d'
  t = t.replace(
    new RegExp('<\\s*t' + zwj + 'hink\\s*>[\\s\\S]*?<\\s*\\/\\s*t' + zwj + 'hink\\s*>', 'gi'),
    ''
  )
  t = t.replace(/<\s*thinking\s*>[\s\S]*?<\s*\/\s*thinking\s*>/gi, '')
  t = t.replace(/<\s*redacted_reasoning\s*>[\s\S]*?<\s*\/\s*redacted_reasoning\s*>/gi, '')
  t = t.replace(/<\s*redacted_thinking\s*>[\s\S]*?<\s*\/\s*redacted_thinking\s*>/gi, '')
  t = t.replace(/<\s*reasoning\s*>[\s\S]*?<\s*\/\s*reasoning\s*>/gi, '')
  return stripPipeBracketSpecialTokens(t)
}

/** ChatML / Llama-style `<|im_s` … `|>`, `<|redacte` … `|>`, `<|eot_id|>`, etc., plus unclosed tails. */
function stripPipeBracketSpecialTokens(s: string): string {
  let t = s.replace(/<\s*\|[^|]{0,500}\|\s*>/g, '')
  const open = t.lastIndexOf('<|')
  if (open >= 0) {
    const rest = t.slice(open)
    if (!/\|>/.test(rest)) t = t.slice(0, open).replace(/\s+\z/, '')
  }
  return t
}

function randomEntryId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}

function clampHueShift(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(-1, n))
}

function normalizePatch(raw: unknown): Partial<ModelPersonalityVibe> {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const out: Partial<ModelPersonalityVibe> = {}
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

  const w = num(o.warmth)
  if (w !== undefined) out.warmth = clamp01(w)
  const e = num(o.energy)
  if (e !== undefined) out.energy = clamp01(e)
  const pl = num(o.playfulness)
  if (pl !== undefined) out.playfulness = clamp01(pl)
  const c = num(o.calm)
  if (c !== undefined) out.calm = clamp01(c)
  const ex = num(o.expressiveness)
  if (ex !== undefined) out.expressiveness = clamp01(ex)
  const h = num(o.hueShift)
  if (h !== undefined) out.hueShift = clampHueShift(h)
  return out
}

function vibeFromPatchLike(p: Partial<ModelPersonalityVibe>): ModelPersonalityVibe {
  const d = DEFAULT_MODEL_PERSONALITY
  return {
    warmth: p.warmth ?? d.warmth,
    energy: p.energy ?? d.energy,
    playfulness: p.playfulness ?? d.playfulness,
    calm: p.calm ?? d.calm,
    expressiveness: p.expressiveness ?? d.expressiveness,
    hueShift: p.hueShift ?? d.hueShift
  }
}

function capJournal(journal: ModelProfileJournalEntry[]): ModelProfileJournalEntry[] {
  if (journal.length <= MAX_MODEL_JOURNAL_ENTRIES) return journal
  return journal.slice(-MAX_MODEL_JOURNAL_ENTRIES)
}

function normalizeLoadedProfile(raw: unknown): ModelProfile {
  if (!raw || typeof raw !== 'object') return defaultModelProfile()
  const o = raw as Record<string, unknown>
  const vibe =
    o.vibe && typeof o.vibe === 'object' ? vibeFromPatchLike(normalizePatch(o.vibe)) : { ...DEFAULT_MODEL_PERSONALITY }
  const journal: ModelProfileJournalEntry[] = []
  if (Array.isArray(o.journal)) {
    for (const row of o.journal) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const text = typeof r.text === 'string' ? r.text.trim() : ''
      if (!text) continue
      const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : randomEntryId()
      const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now()
      journal.push({ id, createdAt, text: text.slice(0, 12_000) })
    }
  }
  return { vibe, journal: capJournal(journal) }
}

export function profileStorageKey(modelPath: string): string {
  return V2_PREFIX + encodeURIComponent(modelPath.trim())
}

export function loadModelProfile(modelPath: string): ModelProfile {
  if (typeof localStorage === 'undefined' || !modelPath.trim()) return defaultModelProfile()
  const enc = encodeURIComponent(modelPath.trim())
  try {
    const v2 = localStorage.getItem(V2_PREFIX + enc)
    if (v2) return normalizeLoadedProfile(JSON.parse(v2) as unknown)

    const v1 = localStorage.getItem(V1_PREFIX + enc)
    if (v1) {
      const vibe = vibeFromPatchLike(normalizePatch(JSON.parse(v1) as unknown))
      const migrated: ModelProfile = { vibe, journal: [] }
      saveModelProfile(modelPath, migrated)
      try {
        localStorage.removeItem(V1_PREFIX + enc)
      } catch {
        /* ignore */
      }
      return migrated
    }
  } catch {
    /* ignore */
  }
  return defaultModelProfile()
}

export function saveModelProfile(modelPath: string, profile: ModelProfile): void {
  if (typeof localStorage === 'undefined' || !modelPath.trim()) return
  try {
    const payload: ModelProfile = {
      vibe: { ...profile.vibe },
      journal: capJournal([...profile.journal])
    }
    localStorage.setItem(profileStorageKey(modelPath), JSON.stringify(payload))
  } catch {
    /* quota */
  }
}

/** @deprecated Use loadModelProfile */
export function loadModelPersonality(modelPath: string): ModelPersonalityVibe {
  return loadModelProfile(modelPath).vibe
}

/** @deprecated Use saveModelProfile with full profile */
export function saveModelPersonality(modelPath: string, vibe: ModelPersonalityVibe): void {
  const cur = loadModelProfile(modelPath)
  saveModelProfile(modelPath, { ...cur, vibe: { ...vibe } })
}

export function mergePersonalityPatches(
  base: ModelPersonalityVibe,
  patch: Partial<ModelPersonalityVibe>,
  blend = 0.34
): ModelPersonalityVibe {
  const out: ModelPersonalityVibe = { ...base }
  const keys: (keyof ModelPersonalityVibe)[] = [
    'warmth',
    'energy',
    'playfulness',
    'calm',
    'expressiveness',
    'hueShift'
  ]
  for (const k of keys) {
    const v = patch[k]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const prev = base[k]
    out[k] = prev * (1 - blend) + v * blend
  }
  for (const k of keys) {
    if (k === 'hueShift') out[k] = clampHueShift(out[k])
    else out[k] = clamp01(out[k])
  }
  return out
}

export function appendJournalTexts(profile: ModelProfile, texts: readonly string[]): ModelProfile {
  const journal = [...profile.journal]
  const now = Date.now()
  for (const raw of texts) {
    const text = raw.replace(/\r\n/g, '\n').trim()
    if (!text) continue
    journal.push({
      id: randomEntryId(),
      createdAt: now,
      text: text.slice(0, 12_000)
    })
  }
  return { ...profile, journal: capJournal(journal) }
}

/** Strip [[JOURNAL]]…, [[MODEL_PROFILE]]…, [[AMB:…]], dangling blocks, thinking/reasoning XML, and `<|…|>` template tokens. */
export function stripModelProfileMarkers(text: string): {
  visible: string
  patches: Partial<ModelPersonalityVibe>[]
  journalTexts: string[]
} {
  const journalTexts: string[] = []
  let s = text
  s = s.replace(JOURNAL_BLOCK_RE, (_, body: string) => {
    const t = body.trim()
    if (t) journalTexts.push(t)
    return ''
  })
  s = s.replace(JOURNAL_LINE_RE, (_, body: string) => {
    const t = body.trim()
    if (t) journalTexts.push(t)
    return ''
  })
  s = s.replace(MODEL_PROFILE_BLOCK_RE, () => '')
  s = s.replace(MODEL_PROFILE_LINE_RE, () => '')

  const patches: Partial<ModelPersonalityVibe>[] = []
  s = stripAmbBlocksLoose(s, patches)
  /* Unclosed [[JOURNAL]] block (no [[/JOURNAL]]) */
  s = s.replace(/\[\[JOURNAL\]\]\s*[\s\S]*$/i, '')
  /* Unclosed [[MODEL_PROFILE]] block (no [[/MODEL_PROFILE]]) */
  s = s.replace(/\[\[MODEL_PROFILE\]\]\s*[\s\S]*$/i, '')

  s = stripReasoningAndThinkTags(s)

  const visible = s.replace(/\s+\n/g, '\n').trimEnd()
  return { visible, patches, journalTexts }
}

/** Strip profile markers and common model leak tags for chat bubbles (no side effects). */
export function stripChatAssistantVisibleMarkers(text: string): string {
  return stripModelProfileMarkers(text).visible
}

/** @deprecated Use stripModelProfileMarkers */
export function stripAmbianceMarkers(text: string): { visible: string; patches: Partial<ModelPersonalityVibe>[] } {
  const r = stripModelProfileMarkers(text)
  return { visible: r.visible, patches: r.patches }
}

/** Hide incomplete trailing profile markers while streaming */
export function stripPartialProfileStreamTail(text: string): string {
  const lower = text.toLowerCase()
  const needleIdx: number[] = []
  const purpleThinkOpen = '<t\u200dhink>'
  const iPurple = text.indexOf(purpleThinkOpen)
  if (iPurple >= 0) needleIdx.push(iPurple)
  const plainThinkOpen = '<' + 'think>'
  const iPlainThink = lower.indexOf(plainThinkOpen.toLowerCase())
  if (iPlainThink >= 0) needleIdx.push(iPlainThink)
  const iPipe = text.indexOf('<|')
  if (iPipe >= 0) needleIdx.push(iPipe)
  for (const m of [
    '[[AMB:',
    '[[MODEL_PROFILE]]',
    '[[MODEL_PROFILE:',
    '[[/MODEL_PROFILE]]',
    '[[JOURNAL]]',
    '[[JOURNAL:',
    '<think>',
    '<thinking>',
    '<redacted_reasoning>',
    '<reasoning>'
  ]) {
    const i = lower.indexOf(m.toLowerCase())
    if (i >= 0) needleIdx.push(i)
  }
  if (needleIdx.length === 0) return text
  return text.slice(0, Math.min(...needleIdx)).trimEnd()
}

/** @deprecated Use stripPartialProfileStreamTail */
export function stripPartialAmbianceStreamTail(text: string): string {
  return stripPartialProfileStreamTail(text)
}

export function personalityStorageKey(modelPath: string): string {
  return profileStorageKey(modelPath)
}
