import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type Database from 'better-sqlite3'
import { listChunksForSource, listSources } from './kbService'

function escXmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\r|\n/g, ' ')
}

/**
 * Export selected KB sources to Alpaca-style JSONL for LoRA / fine-tune pipelines.
 * One record per chunk: `instruction` is a single self-closing **tag** with metadata; `output` is raw chunk text.
 */
export function exportKbSourcesToTrainingJsonl(
  db: Database.Database,
  sourceIds: string[],
  destPath: string
): { linesWritten: number; sourcesUsed: string[] } {
  const ids = [...new Set(sourceIds.map((s) => s.trim()).filter(Boolean))]
  if (ids.length === 0) throw new Error('Select at least one knowledge source.')

  const known = new Set(listSources(db).map((s) => s.id))
  for (const id of ids) {
    if (!known.has(id)) throw new Error(`Unknown knowledge source id: ${id}`)
  }

  mkdirSync(dirname(destPath), { recursive: true })

  const lines: string[] = []
  const sourcesUsed: string[] = []

  for (const sourceId of ids) {
    const chunks = listChunksForSource(db, sourceId)
    const meta = db.prepare('SELECT title FROM kb_sources WHERE id = ?').get(sourceId) as { title: string } | undefined
    const title = meta?.title?.trim() || sourceId
    if (chunks.length === 0) continue
    sourcesUsed.push(sourceId)

    for (const ch of chunks) {
      const h = ch.heading?.trim()
      const headingAttr = h ? ` heading="${escXmlAttr(h)}"` : ''
      const instruction = `<kb-chunk source-id="${escXmlAttr(sourceId)}" title="${escXmlAttr(title)}"${headingAttr}/>`
      const context = h ? `Source "${title}" section "${h}"` : `Source "${title}"`
      lines.push(
        JSON.stringify({
          instruction,
          context,
          input: '',
          output: ch.text.trim(),
          rationale: 'Verbatim domain knowledge captured from local usage-derived knowledge base.',
          provenance: {
            sourceId,
            title,
            heading: h ?? null,
            ord: ch.ord
          }
        })
      )
    }
  }

  if (lines.length === 0) {
    throw new Error('No text chunks found in the selected sources. Add content to the knowledge base first.')
  }

  writeFileSync(destPath, `${lines.join('\n')}\n`, 'utf8')
  return { linesWritten: lines.length, sourcesUsed }
}
