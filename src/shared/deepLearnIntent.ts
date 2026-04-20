/**
 * Detect "learn everything / everythin about …" style prompts and extract subject + URLs.
 */

/** Allows “everything”, typo “everythin”, etc. (`g` optional before “about”). */
const DEEP_LEARN_TRIGGER = /\blearn\s+every\s*thin?g?\s+about\s+/i

/** Rough URL token scan for http(s) links the user pasted (approval required before fetch). */
const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"')\]}]+/gi

export type DeepLearnIntentParse = {
  isDeepLearn: boolean
  /** Text after the trigger, URLs removed, trimmed (for KB title and prompts). */
  subject: string
  /** Distinct http(s) URLs found in the full message (deduped, original order). */
  candidateUrls: string[]
}

function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of urls) {
    const key = u.trim()
    if (!seen.has(key)) {
      seen.add(key)
      out.push(key)
    }
  }
  return out
}

/**
 * Extract http(s) URLs from arbitrary user text.
 */
export function extractHttpUrls(text: string): string[] {
  const m = text.match(URL_IN_TEXT)
  if (!m?.length) return []
  const normalized = m.map((u) => u.replace(/[.,;:!?]+$/g, ''))
  return dedupeUrls(normalized)
}

/**
 * True when the message matches the deep-learn trigger (case-insensitive, "everythin" typo allowed).
 */
export function messageMatchesDeepLearnIntent(userMessage: string): boolean {
  const t = userMessage.trim()
  if (!t) return false
  return DEEP_LEARN_TRIGGER.test(t)
}

/**
 * Parse subject line and candidate URLs. When `isDeepLearn` is false, other fields are empty.
 */
export function parseDeepLearnIntent(userMessage: string): DeepLearnIntentParse {
  const trimmed = userMessage.trim()
  if (!trimmed) {
    return { isDeepLearn: false, subject: '', candidateUrls: [] }
  }
  const m = trimmed.match(DEEP_LEARN_TRIGGER)
  if (!m || m.index == null) {
    return { isDeepLearn: false, subject: '', candidateUrls: [] }
  }
  const afterTrigger = trimmed.slice(m.index + m[0].length).trim()
  const candidateUrls = extractHttpUrls(trimmed)

  let subject = afterTrigger
  for (const u of candidateUrls) {
    subject = subject.split(u).join(' ')
  }
  subject = subject.replace(/\s+/g, ' ').trim()
  if (subject.startsWith('"') && subject.endsWith('"') && subject.length >= 2) {
    subject = subject.slice(1, -1).trim()
  }
  if (subject.startsWith("'") && subject.endsWith("'") && subject.length >= 2) {
    subject = subject.slice(1, -1).trim()
  }
  if (!subject) {
    subject = 'this topic'
  }
  subject = subject.slice(0, 400)

  return {
    isDeepLearn: true,
    subject,
    candidateUrls
  }
}

export function deepLearnNeedsUrlApproval(candidateUrls: string[]): boolean {
  return candidateUrls.length > 0
}
