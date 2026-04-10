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

Use the journal when you have a genuine in-character reflection; skip both blocks when not meaningful.`

/** @deprecated Use MODEL_PROFILE_SYSTEM_PROMPT */
export const MODEL_AMBIENCE_SYSTEM_PROMPT = MODEL_PROFILE_SYSTEM_PROMPT

const V2_PREFIX = 'modelProfile:v2:'
const V1_PREFIX = 'modelPersonality:v1:'

const AMB_RE = /\[\[AMB:\s*(\{[\s\S]*?\})\s*\]\]/gi
const JOURNAL_BLOCK_RE = /\[\[JOURNAL\]\]\s*([\s\S]*?)\s*\[\[\/JOURNAL\]\]/gi
/** Single-line; avoid ] inside the line */
const JOURNAL_LINE_RE = /\[\[JOURNAL:\s*([^\]\n]+?)\s*\]\]/gi

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

/** Strip [[JOURNAL]]…[[/JOURNAL]], [[JOURNAL:…]], and [[AMB:…]] */
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

  const patches: Partial<ModelPersonalityVibe>[] = []
  s = s.replace(AMB_RE, (_, json: string) => {
    try {
      const parsed = JSON.parse(json) as unknown
      const p = normalizePatch(parsed)
      if (Object.keys(p).length) patches.push(p)
    } catch {
      /* ignore */
    }
    return ''
  })

  const visible = s.replace(/\s+\n/g, '\n').trimEnd()
  return { visible, patches, journalTexts }
}

/** @deprecated Use stripModelProfileMarkers */
export function stripAmbianceMarkers(text: string): { visible: string; patches: Partial<ModelPersonalityVibe>[] } {
  const r = stripModelProfileMarkers(text)
  return { visible: r.visible, patches: r.patches }
}

/** Hide incomplete trailing profile markers while streaming */
export function stripPartialProfileStreamTail(text: string): string {
  const markers = ['[[AMB:', '[[JOURNAL]]', '[[JOURNAL:']
  const idx = markers.map((m) => text.indexOf(m)).filter((i) => i >= 0)
  if (idx.length === 0) return text
  return text.slice(0, Math.min(...idx)).trimEnd()
}

/** @deprecated Use stripPartialProfileStreamTail */
export function stripPartialAmbianceStreamTail(text: string): string {
  return stripPartialProfileStreamTail(text)
}

export function personalityStorageKey(modelPath: string): string {
  return profileStorageKey(modelPath)
}
