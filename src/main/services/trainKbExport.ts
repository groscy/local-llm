import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import type Database from 'better-sqlite3'
import { listChunksForSource, listSources } from './kbService'

/**
 * Export selected KB sources to Alpaca-style JSONL for LoRA / fine-tune pipelines.
 * One record per chunk: instruction names the source, output is the chunk body.
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
      const headingPart = ch.heading?.trim() ? ` — ${ch.heading.trim()}` : ''
      const instruction = `Use this knowledge base excerpt from «${title}»${headingPart}. Internalize facts for downstream Q&A.`
      lines.push(
        JSON.stringify({
          instruction,
          input: '',
          output: ch.text.trim()
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
