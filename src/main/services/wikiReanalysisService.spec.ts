import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate } from '../db/migrations'
import { applyWikiReanalysis, ensureWikiVersioningBackfill, getKnowledgeGraph, ingestText, listWikiTopics } from './kbService'
import { parseWikiReanalyzeResponse } from './wikiReanalysisService'

describe('parseWikiReanalyzeResponse', () => {
  it('parses canonical keyword, markdown, and relations JSON', () => {
    const raw = `<canonical_keyword>Graph Database</canonical_keyword>
<entry_markdown>## Notes
Core idea.</entry_markdown>
<relations_json>[{"keyword":"knowledge graph","relation":"related_to","confidence":0.8}]</relations_json>`
    const parsed = parseWikiReanalyzeResponse(raw)
    expect(parsed).not.toBeNull()
    expect(parsed?.canonicalKeyword).toBe('graph database')
    expect(parsed?.markdown).toContain('Core idea')
    expect(parsed?.relations[0]?.keyword).toBe('knowledge graph')
  })
})

describe('wiki reanalysis storage and graph edges', () => {
  let db: Database.Database
  const canOpenSqlite = (() => {
    try {
      const probe = new Database(':memory:')
      probe.close()
      return true
    } catch {
      return false
    }
  })()
  const maybeIt = canOpenSqlite ? it : it.skip

  afterEach(() => {
    if (db) db.close()
  })

  maybeIt('backfills entries and emits semantic relation edges', () => {
    db = new Database(':memory:')
    migrate(db)

    const a = ingestText(db, 'Alpha Concept', 'file://a.md', 'Alpha body')
    const b = ingestText(db, 'Beta Concept', 'file://b.md', 'Beta body')

    ensureWikiVersioningBackfill(db)
    const initialEntries = db.prepare('SELECT COUNT(*) as c FROM wiki_entries').get() as { c: number }
    expect(initialEntries.c).toBeGreaterThan(0)

    const summary = applyWikiReanalysis(db, {
      modelId: 'test-model',
      promptVersion: 'test.v1',
      entries: [
        {
          canonicalKeyword: 'alpha concept',
          title: 'Alpha Concept',
          body: '::: glossary\n**Alpha Concept** - definition.\n:::',
          sourceIds: [a.id],
          relations: [{ toKeyword: 'beta concept', relationType: 'depends_on', confidence: 0.91 }]
        },
        {
          canonicalKeyword: 'beta concept',
          title: 'Beta Concept',
          body: '::: glossary\n**Beta Concept** - definition.\n:::',
          sourceIds: [b.id],
          relations: []
        }
      ]
    })
    expect(summary.ok).toBe(true)
    expect(summary.processedEntries).toBeGreaterThanOrEqual(2)

    const kg = getKnowledgeGraph(db)
    const semanticEdges = kg.edges.filter((e) => e.kind === 'semantic_related')
    expect(semanticEdges.length).toBeGreaterThan(0)

    const topics = listWikiTopics(db)
    expect(topics.length).toBeGreaterThanOrEqual(2)
  })
})

