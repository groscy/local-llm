import type {
  CanonicalEntityCandidate,
  CanonicalIngestRecord,
  CanonicalRelationCandidate
} from '@shared/types'
import { ONTOLOGY_ADJECTIVE_PATTERNS, ONTOLOGY_RELATION_RULES } from './ontologyRuleRegistry'

type SentenceSpan = { sentence: string; start: number; end: number }

const STOP_WORDS = new Set([
  'about',
  'above',
  'across',
  'after',
  'again',
  'against',
  'along',
  'also',
  'among',
  'another',
  'around',
  'because',
  'before',
  'being',
  'below',
  'between',
  'build',
  'built',
  'cannot',
  'chat',
  'context',
  'could',
  'create',
  'created',
  'creates',
  'default',
  'domain',
  'during',
  'each',
  'either',
  'from',
  'have',
  'having',
  'into',
  'just',
  'like',
  'more',
  'most',
  'need',
  'only',
  'other',
  'over',
  'runtime',
  'same',
  'should',
  'such',
  'than',
  'that',
  'their',
  'there',
  'these',
  'this',
  'those',
  'through',
  'under',
  'using',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'with',
  'within',
  'would'
])

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function canonicalEntityLabel(raw: string): string {
  const cleaned = raw
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[`"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 128)
}

function seemsNoisyToken(token: string): boolean {
  if (!token) return true
  if (/https?:\/\//i.test(token)) return true
  if (/[\\/]/.test(token) && !/[A-Za-z]/.test(token.replace(/[\\/]/g, ''))) return true
  if (/^[a-f0-9]{12,}$/i.test(token)) return true
  if (/\d{4,}/.test(token) && !/[A-Za-z]/.test(token)) return true
  if (/[{}[\]<>]/.test(token)) return true
  return false
}

function lexicalSignal(label: string): number {
  const words = label.split(/\s+/).filter(Boolean)
  if (words.length === 0) return 0
  const properWordBoost = words.some((w) => /^[A-Z][a-z]/.test(w)) ? 0.08 : 0
  const phraseBoost = words.length >= 2 ? Math.min(0.2, (words.length - 1) * 0.05) : 0
  const acronymBoost = words.some((w) => /^[A-Z]{2,8}$/.test(w)) ? 0.06 : 0
  return properWordBoost + phraseBoost + acronymBoost
}

function splitSentencesWithOffsets(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = []
  const re = /[^.!?\n]+[.!?]?/g
  for (const m of text.matchAll(re)) {
    const raw = m[0] ?? ''
    const sentence = raw.replace(/\s+/g, ' ').trim()
    if (sentence.length < 4) continue
    const start = m.index ?? 0
    out.push({ sentence, start, end: start + raw.length })
    if (out.length >= 72) break
  }
  return out
}

function phraseCandidates(record: CanonicalIngestRecord): Array<{ label: string; start: number; end: number; reason: string }> {
  const out: Array<{ label: string; start: number; end: number; reason: string }> = []
  const phraseRe = /\b([A-Z][A-Za-z0-9_-]{2,}(?:\s+[A-Z][A-Za-z0-9_-]{2,}){0,3})\b/g
  for (const m of record.body.matchAll(phraseRe)) {
    const raw = m[1] ?? ''
    const label = canonicalEntityLabel(raw)
    if (!label || seemsNoisyToken(label)) continue
    const slug = toSlug(label)
    if (!slug || STOP_WORDS.has(slug)) continue
    const start = m.index ?? 0
    out.push({ label, start, end: start + raw.length, reason: 'noun_pass_title_phrase' })
    if (out.length >= 64) break
  }
  return out
}

function nounCandidates(record: CanonicalIngestRecord): CanonicalEntityCandidate[] {
  const counts = new Map<string, { count: number; start: number; end: number; reasons: Set<string> }>()
  const tokenRe = /[A-Za-z][A-Za-z0-9_/-]{2,}/g
  for (const m of record.body.matchAll(tokenRe)) {
    const raw = m[0] ?? ''
    const normalized = canonicalEntityLabel(raw)
    if (seemsNoisyToken(normalized)) continue
    const slug = toSlug(normalized)
    if (slug.length < 3 || STOP_WORDS.has(slug)) continue
    const start = m.index ?? 0
    const end = start + raw.length
    if (!counts.has(normalized)) {
      counts.set(normalized, { count: 0, start, end, reasons: new Set(['noun_pass_token_match']) })
    }
    const cur = counts.get(normalized)!
    cur.count += 1
    if (cur.count >= 2) cur.reasons.add('noun_pass_frequency_boost')
    if (/^[A-Z]/.test(raw)) cur.reasons.add('noun_pass_titlecase_signal')
  }
  for (const phrase of phraseCandidates(record)) {
    if (!counts.has(phrase.label)) {
      counts.set(phrase.label, { count: 0, start: phrase.start, end: phrase.end, reasons: new Set() })
    }
    const cur = counts.get(phrase.label)!
    cur.count += 2
    cur.reasons.add(phrase.reason)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 48)
    .map(([label, meta]) => ({
      recordId: record.id,
      label,
      entityType: 'concept',
      confidence: Math.min(0.97, 0.42 + meta.count * 0.08 + lexicalSignal(label)),
      start: meta.start,
      end: meta.end,
      evidenceText: record.body.slice(meta.start, Math.min(record.body.length, meta.end + 140)),
      confidenceReasons: [...meta.reasons]
    }))
}

function relationCandidates(record: CanonicalIngestRecord): CanonicalRelationCandidate[] {
  const out: CanonicalRelationCandidate[] = []
  const sentences = splitSentencesWithOffsets(record.body)
  for (const span of sentences) {
    const s = span.sentence.replace(/\s+/g, ' ').trim()
    if (!s) continue
    for (const rule of ONTOLOGY_RELATION_RULES) {
      const m = s.match(rule.regex)
      if (!m) continue
      const subject = canonicalEntityLabel(m[1] ?? '')
      const object = canonicalEntityLabel(m[2] ?? '')
      if (seemsNoisyToken(subject) || seemsNoisyToken(object)) continue
      if (subject.length < 3 || object.length < 3 || subject === object) continue
      const subjSlug = toSlug(subject)
      const objSlug = toSlug(object)
      if (STOP_WORDS.has(subjSlug) || STOP_WORDS.has(objSlug)) continue
      out.push({
        recordId: record.id,
        fromEntityLabel: subject,
        toEntityLabel: object,
        predicate: rule.predicate,
        verb: rule.verb,
        confidence: 0.66 + Math.min(0.2, lexicalSignal(subject) * 0.4 + lexicalSignal(object) * 0.4),
        start: span.start,
        end: span.end,
        evidenceText: record.body.slice(span.start, Math.min(record.body.length, span.end + 120)),
        ruleId: rule.id,
        confidenceReasons: ['verb_pass_rule_match', `verb_pass_${rule.id.replace('.', '_')}`]
      })
      if (out.length >= 96) return out
    }
  }
  return out
}

export function descriptorCandidates(record: CanonicalIngestRecord): CanonicalEntityCandidate[] {
  const out: CanonicalEntityCandidate[] = []
  const seen = new Set<string>()
  const spans = splitSentencesWithOffsets(record.body)
  for (const span of spans) {
    for (const pattern of ONTOLOGY_ADJECTIVE_PATTERNS) {
      pattern.regex.lastIndex = 0
      for (const m of span.sentence.matchAll(pattern.regex)) {
        const adjective = String(m[2] ?? '').toLowerCase().trim()
        const targetRaw = pattern.id === 'rule.adj_prefix' ? String(m[3] ?? '') : String(m[1] ?? '')
        const target = canonicalEntityLabel(targetRaw)
        if (adjective.length < 3 || adjective.length > 32 || target.length < 3) continue
        if (STOP_WORDS.has(adjective) || seemsNoisyToken(target)) continue
        if (/^(the|this|that|these|those)$/i.test(adjective)) continue
        const key = `${target.toLowerCase()}\0${adjective}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          recordId: record.id,
          label: `${adjective} ${target}`,
          entityType: 'descriptor',
          confidence: 0.66,
          start: span.start,
          end: span.end,
          evidenceText: record.body.slice(span.start, Math.min(record.body.length, span.end + 120)),
          confidenceReasons: ['adjective_pass_pattern_match', `adjective_pass_${pattern.id.replace('.', '_')}`]
        })
      }
    }
  }
  return out
}

export function mapCanonicalRecordToOntology(record: CanonicalIngestRecord): {
  entities: CanonicalEntityCandidate[]
  relations: CanonicalRelationCandidate[]
  descriptors: CanonicalEntityCandidate[]
} {
  return {
    entities: nounCandidates(record),
    relations: relationCandidates(record),
    descriptors: descriptorCandidates(record)
  }
}
