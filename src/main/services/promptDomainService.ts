import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type { PromptDomainRow } from '@shared/types'
import { MAX_PROMPT_DOMAIN_SUFFIX_CHARS } from '@shared/promptDomains'
import { logLine } from '../logger'

/** Max keyword stems stored per domain (union grows on merge / new prompts). */
const MAX_KEYWORDS_PER_DOMAIN = 72

/** Assign user prompt to existing domain when Jaccard(keywords) ≥ this. */
const ASSIGN_THRESHOLD = 0.18
/** Merge two domains when their keyword sets overlap ≥ this. */
const MERGE_THRESHOLD = 0.48
/** Minimum token overlap to treat two split segments as unrelated (else keep single segment). */
const SPLIT_MAX_OVERLAP = 0.32
/** Ignore user prompts shorter than this (noise / greetings). */
const MIN_PROMPT_CHARS = 12

const STOPWORDS = new Set(
  `a an the and or but if then else for while do with from to of in on at by as is are was were be been being
  it this that these those i you we they he she my your our their what which who how when where why not no yes
  can could should would will just like get got use using used make made into out up down over also only even
  very much more most some any all each both than so about please thanks hello hi hey ok okay sure help need want
  tell give show me my the a an to from`.split(/\s+/)
)

function normalizeToken(raw: string): string | null {
  const t = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '')
  if (t.length < 2) return null
  if (STOPWORDS.has(t)) return null
  return t
}

export function extractKeywordSet(text: string): Set<string> {
  const out = new Set<string>()
  const parts = text.toLowerCase().split(/[^a-z0-9_]+/i)
  for (const p of parts) {
    const n = normalizeToken(p)
    if (n) out.add(n)
  }
  return out
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) {
    if (b.has(x)) inter++
  }
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function mergeKeywordLists(a: string[], b: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of [...a, ...b]) {
    const n = normalizeToken(x) ?? (x.length >= 2 ? x.toLowerCase() : '')
    if (!n || seen.has(n)) continue
    seen.add(n)
    out.push(n)
    if (out.length >= MAX_KEYWORDS_PER_DOMAIN) break
  }
  return out
}

/** Heuristic split: strong separators or two weakly overlapping paragraphs / clauses. */
export function splitPromptIntoTopicSegments(text: string): string[] {
  const t = text.trim()
  if (t.length < MIN_PROMPT_CHARS) return []
  if (t.length < 48) return [t]

  const strongSplit = /\s+(?:and also|but also|versus\b|\bvs\.?\s+|compared to|on the other hand)\s+/i
  if (strongSplit.test(t)) {
    const parts = t
      .split(strongSplit)
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_PROMPT_CHARS)
    if (parts.length >= 2) {
      const sets = parts.map(extractKeywordSet)
      if (sets.every((s) => s.size >= 2)) {
        let unrelated = true
        for (let i = 0; i < sets.length; i++) {
          for (let j = i + 1; j < sets.length; j++) {
            if (jaccard(sets[i]!, sets[j]!) > SPLIT_MAX_OVERLAP) unrelated = false
          }
        }
        if (unrelated) return parts.slice(0, 4)
      }
    }
  }

  const paras = t
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 40)
  if (paras.length >= 2) {
    const s0 = extractKeywordSet(paras[0]!)
    const s1 = extractKeywordSet(paras[1]!)
    if (s0.size >= 3 && s1.size >= 3 && jaccard(s0, s1) < 0.22) {
      return paras.slice(0, 3)
    }
  }

  return [t]
}

function titleFromSegment(segment: string, keywords: Set<string>): string {
  const fromKw = [...keywords].slice(0, 4).join(', ')
  if (fromKw.length >= 8) return fromKw.length > 72 ? `${fromKw.slice(0, 69)}…` : fromKw
  const oneLine = segment.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= 64) return oneLine || 'Topic'
  return `${oneLine.slice(0, 61)}…`
}

type DomainRow = {
  id: string
  title: string
  keywords_json: string
  created_at: number
  updated_at: number
  system_suffix: string | null
}

function parseKeywords(json: string): string[] {
  try {
    const a = JSON.parse(json) as unknown
    if (!Array.isArray(a)) return []
    return a.filter((x): x is string => typeof x === 'string')
  } catch {
    return []
  }
}

function loadDomains(db: Database.Database, limit = 400): DomainRow[] {
  return db
    .prepare(
      `SELECT id, title, keywords_json, created_at, updated_at,
              COALESCE(system_suffix, '') AS system_suffix
       FROM prompt_domains
       ORDER BY updated_at DESC LIMIT ?`
    )
    .all(limit) as DomainRow[]
}

function findBestDomain(
  domains: DomainRow[],
  tokens: Set<string>
): { id: string; score: number; keywords: string[] } | null {
  let best: { id: string; score: number; keywords: string[] } | null = null
  for (const d of domains) {
    const kw = parseKeywords(d.keywords_json)
    const set = new Set(kw)
    const score = jaccard(tokens, set)
    if (!best || score > best.score) best = { id: d.id, score, keywords: kw }
  }
  return best
}

function insertDomain(db: Database.Database, title: string, keywords: string[]): string {
  const id = randomUUID()
  const t = Date.now()
  const kjson = JSON.stringify(keywords.slice(0, MAX_KEYWORDS_PER_DOMAIN))
  db.prepare(
    `INSERT INTO prompt_domains (id, title, keywords_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, title, kjson, t, t)
  return id
}

function updateDomainKeywords(db: Database.Database, domainId: string, extraTokens: Set<string>): void {
  const row = db.prepare('SELECT keywords_json FROM prompt_domains WHERE id = ?').get(domainId) as
    | { keywords_json: string }
    | undefined
  if (!row) return
  const existing = parseKeywords(row.keywords_json)
  const merged = mergeKeywordLists(existing, [...extraTokens])
  db.prepare('UPDATE prompt_domains SET keywords_json = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(merged),
    Date.now(),
    domainId
  )
}

function linkMessage(db: Database.Database, messageId: string, domainId: string, weight: number): void {
  db.prepare(
    `INSERT OR REPLACE INTO message_prompt_domains (message_id, domain_id, weight) VALUES (?, ?, ?)`
  ).run(messageId, domainId, weight)
}

function mergeTwoDomains(db: Database.Database, keepId: string, dropId: string): void {
  if (keepId === dropId) return
  const keepRow = db
    .prepare('SELECT keywords_json, COALESCE(system_suffix, \'\') AS system_suffix FROM prompt_domains WHERE id = ?')
    .get(keepId) as { keywords_json: string; system_suffix: string } | undefined
  const dropRow = db
    .prepare('SELECT keywords_json, COALESCE(system_suffix, \'\') AS system_suffix FROM prompt_domains WHERE id = ?')
    .get(dropId) as { keywords_json: string; system_suffix: string } | undefined
  if (!keepRow || !dropRow) return

  const mergedSuffix = (() => {
    const a = keepRow.system_suffix.trim()
    const b = dropRow.system_suffix.trim()
    if (a && b && a !== b) return `${a}\n\n${b}`.slice(0, MAX_PROMPT_DOMAIN_SUFFIX_CHARS)
    return (a || b).slice(0, MAX_PROMPT_DOMAIN_SUFFIX_CHARS)
  })()

  const tr = db.transaction(() => {
    const mids = db
      .prepare('SELECT message_id FROM message_prompt_domains WHERE domain_id = ?')
      .all(dropId) as { message_id: string }[]
    for (const { message_id } of mids) {
      const hasKeep = db
        .prepare('SELECT 1 FROM message_prompt_domains WHERE message_id = ? AND domain_id = ?')
        .get(message_id, keepId)
      if (hasKeep) {
        db.prepare('DELETE FROM message_prompt_domains WHERE message_id = ? AND domain_id = ?').run(message_id, dropId)
      } else {
        db.prepare('UPDATE message_prompt_domains SET domain_id = ? WHERE message_id = ? AND domain_id = ?').run(
          keepId,
          message_id,
          dropId
        )
      }
    }
    const k = mergeKeywordLists(parseKeywords(keepRow.keywords_json), parseKeywords(dropRow.keywords_json))
    db.prepare(
      'UPDATE prompt_domains SET keywords_json = ?, system_suffix = ?, updated_at = ? WHERE id = ?'
    ).run(JSON.stringify(k), mergedSuffix || null, Date.now(), keepId)
    db.prepare('DELETE FROM prompt_domains WHERE id = ?').run(dropId)
  })
  tr()
  logLine('info', 'prompt_domains_merged', { keepId, dropId })
}

/** Merge highly overlapping domains (globally). */
export function mergeRelatedDomains(db: Database.Database): void {
  for (;;) {
    const rows = loadDomains(db, 500)
    let mergedOne = false
    outer: for (let i = 0; i < rows.length; i++) {
      const a = rows[i]!
      const ka = new Set(parseKeywords(a.keywords_json))
      if (ka.size === 0) continue
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j]!
        const kb = new Set(parseKeywords(b.keywords_json))
        if (jaccard(ka, kb) >= MERGE_THRESHOLD) {
          const keep = a.created_at <= b.created_at ? a.id : b.id
          const drop = keep === a.id ? b.id : a.id
          mergeTwoDomains(db, keep, drop)
          mergedOne = true
          break outer
        }
      }
    }
    if (!mergedOne) break
  }
}

/**
 * After a user message is stored: segment prompt, assign or create domains, then merge related domains.
 */
export function assignUserMessageToPromptDomains(db: Database.Database, messageId: string, rawContent: string): void {
  const segments = splitPromptIntoTopicSegments(rawContent)
  if (segments.length === 0) return

  let domains = loadDomains(db)
  const weight = segments.length > 1 ? 1 / segments.length : 1

  for (const segment of segments) {
    const tokens = extractKeywordSet(segment)
    if (tokens.size < 2 && segment.length < 40) continue

    const kwArr = [...tokens].slice(0, MAX_KEYWORDS_PER_DOMAIN)
    const best = findBestDomain(domains, tokens)

    let domainId: string
    if (best && best.score >= ASSIGN_THRESHOLD) {
      domainId = best.id
      updateDomainKeywords(db, domainId, tokens)
    } else {
      const title = titleFromSegment(segment, tokens)
      const toStore =
        kwArr.length > 0
          ? kwArr
          : [
              segment
                .slice(0, 40)
                .replace(/\s+/g, ' ')
                .trim()
                .toLowerCase() || 'general'
            ]
      domainId = insertDomain(db, title, toStore.slice(0, MAX_KEYWORDS_PER_DOMAIN))
      domains = loadDomains(db)
    }
    linkMessage(db, messageId, domainId, weight)
  }

  mergeRelatedDomains(db)
}

export function listPromptDomains(db: Database.Database, limit = 200): PromptDomainRow[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.title, d.keywords_json AS keywordsJson, d.created_at AS createdAt, d.updated_at AS updatedAt,
              COALESCE(d.system_suffix, '') AS systemSuffix,
              COUNT(m.message_id) AS messageCount
       FROM prompt_domains d
       LEFT JOIN message_prompt_domains m ON m.domain_id = d.id
       GROUP BY d.id
       ORDER BY d.updated_at DESC
       LIMIT ?`
    )
    .all(limit) as Record<string, unknown>[]

  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    keywords: parseKeywords(String(r.keywordsJson)),
    systemSuffix: typeof r.systemSuffix === 'string' ? r.systemSuffix : '',
    createdAt: Number(r.createdAt),
    updatedAt: Number(r.updatedAt),
    messageCount: Number(r.messageCount) || 0
  }))
}

export function updatePromptDomainSystemSuffix(db: Database.Database, domainId: string, systemSuffix: string): void {
  const id = domainId.trim()
  if (!id) return
  const t = Date.now()
  const trimmed = systemSuffix.trim().slice(0, MAX_PROMPT_DOMAIN_SUFFIX_CHARS)
  db.prepare('UPDATE prompt_domains SET system_suffix = ?, updated_at = ? WHERE id = ?').run(
    trimmed || null,
    t,
    id
  )
}

/**
 * Build a bounded system-message fragment from domains linked to this user message.
 */
export function collectDomainSystemSuffixForMessage(db: Database.Database, messageId: string): string {
  const rows = db
    .prepare(
      `SELECT COALESCE(d.system_suffix, '') AS suffix, m.weight AS w
       FROM message_prompt_domains m
       JOIN prompt_domains d ON d.id = m.domain_id
       WHERE m.message_id = ?
       ORDER BY m.weight DESC, d.updated_at DESC`
    )
    .all(messageId) as { suffix: string; w: number }[]

  const parts: string[] = []
  let total = 0
  for (const r of rows) {
    const s = (r.suffix ?? '').trim()
    if (!s) continue
    const sep = parts.length > 0 ? '\n\n' : ''
    const nextLen = total + sep.length + s.length
    if (nextLen > MAX_PROMPT_DOMAIN_SUFFIX_CHARS) {
      const room = MAX_PROMPT_DOMAIN_SUFFIX_CHARS - total - sep.length
      if (room < 32) break
      parts.push(s.slice(0, room))
      break
    }
    parts.push(s)
    total = nextLen
  }
  return parts.join('\n\n')
}
