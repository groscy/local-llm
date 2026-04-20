import type { WikiSourceKind, WikiTopic } from './types'

export const WIKI_KIND_ORDER: WikiSourceKind[] = ['document', 'extracted_note', 'saved_chat', 'other']

export const WIKI_KIND_LABELS: Record<WikiSourceKind, string> = {
  document: 'Documents',
  extracted_note: 'Chat notes',
  saved_chat: 'Saved chats',
  other: 'Other'
}

/** Same rules as `wikiKindFromUri` in kbService — keep in sync for consistent grouping. */
export function wikiKindFromUri(uri: string): WikiSourceKind {
  const u = uri.toLowerCase()
  if (u.startsWith('file:')) return 'document'
  if (u.startsWith('wiki-extract:')) return 'extracted_note'
  if (u.startsWith('deep-learn:')) return 'extracted_note'
  if (u.startsWith('chat:')) return 'saved_chat'
  return 'other'
}

export function groupWikiTopicsByKind(topics: WikiTopic[]): Map<WikiSourceKind, WikiTopic[]> {
  const m = new Map<WikiSourceKind, WikiTopic[]>()
  for (const k of WIKI_KIND_ORDER) m.set(k, [])
  for (const t of topics) {
    const bucket = m.get(t.kind) ?? m.get('other')!
    bucket.push(t)
  }
  return m
}

export function wikiKindCounts(topics: WikiTopic[]): Record<WikiSourceKind, number> {
  const m: Record<WikiSourceKind, number> = {
    document: 0,
    extracted_note: 0,
    saved_chat: 0,
    other: 0
  }
  for (const t of topics) {
    const k: WikiSourceKind = WIKI_KIND_ORDER.includes(t.kind) ? t.kind : 'other'
    m[k]++
  }
  return m
}

/** Case- and whitespace-insensitive key so multiple chat notes with the same keyword title group together. */
export function wikiNoteGroupKey(title: string): string {
  return title.replace(/\s+/g, ' ').trim().toLowerCase()
}

export type WikiSidebarRow =
  | { rowKind: 'topic'; topic: WikiTopic }
  | { rowKind: 'group'; groupKey: string; label: string; topics: WikiTopic[] }

/**
 * Flat list of topics for one library kind → sidebar rows (chat notes with the same keyword become one expandable group).
 */
export function wikiSidebarRowsForKind(kind: WikiSourceKind, topics: WikiTopic[]): WikiSidebarRow[] {
  if (kind !== 'extracted_note' || topics.length === 0) {
    return topics.map((topic) => ({ rowKind: 'topic' as const, topic }))
  }

  const buckets = new Map<string, WikiTopic[]>()
  const order: string[] = []
  for (const t of topics) {
    const k = wikiNoteGroupKey(t.title)
    if (!buckets.has(k)) {
      buckets.set(k, [])
      order.push(k)
    }
    buckets.get(k)!.push(t)
  }

  const out: WikiSidebarRow[] = []
  for (const k of order) {
    const arr = buckets.get(k)!
    if (arr.length === 1) out.push({ rowKind: 'topic', topic: arr[0] })
    else {
      const label = arr[0].title.replace(/\s+/g, ' ').trim() || arr[0].title
      out.push({ rowKind: 'group', groupKey: k, label, topics: arr })
    }
  }
  return out
}
