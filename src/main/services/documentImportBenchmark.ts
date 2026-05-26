import { readFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { parseDocumentFromBytes } from './documentParser'
import { mapCanonicalRecordToOntology } from './ontologyMappingEngine'
import { randomUUID } from 'crypto'
import type { CanonicalIngestRecord } from '@shared/types'

type GoldenRelation = { from: string; predicate: string; to: string }
type GoldenAnnotation = {
  expectedEntities?: string[]
  expectedRelations?: GoldenRelation[]
  mustReject?: string[]
}

export type ImportBenchmarkDocumentResult = {
  id: string
  filePath: string
  parserMode: string
  parserWarnings: string[]
  textLength: number
  expectedEntities: number
  extractedEntities: number
  entityPrecision: number
  entityRecall: number
  relationPrecision: number
  relationRecall: number
  mustRejectFalsePositiveRate: number
  parserHardFailure: boolean
}

export type ImportBenchmarkSummary = {
  corpusPath: string
  generatedAt: number
  documents: number
  entityPrecision: number
  entityRecall: number
  relationPrecision: number
  relationRecall: number
  mustRejectFalsePositiveRate: number
  parserHardFailureRate: number
  results: ImportBenchmarkDocumentResult[]
}

function listDocumentFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = statSync(path)
      if (stat.isDirectory()) {
        walk(path)
        continue
      }
      const ext = extname(path).toLowerCase()
      if (['.pdf', '.txt', '.md', '.html', '.htm'].includes(ext)) out.push(path)
    }
  }
  walk(root)
  return out
}

function readGolden(filePath: string): GoldenAnnotation {
  const base = filePath.replace(/\.[^.]+$/, '')
  const goldenPath = `${base}.golden.json`
  try {
    const parsed = JSON.parse(readFileSync(goldenPath, 'utf8')) as GoldenAnnotation
    return parsed
  } catch {
    return {}
  }
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[`"'()[\]{}]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function safeDiv(a: number, b: number): number {
  if (b <= 0) return 0
  return Number((a / b).toFixed(4))
}

function buildCanonicalRecord(filePath: string, body: string): CanonicalIngestRecord {
  return {
    id: randomUUID(),
    recordType: 'document',
    title: basename(filePath),
    body,
    provenance: {
      sourceSystem: 'benchmark',
      sourceType: 'file',
      sourceRecordId: filePath,
      sourceUri: `file://${filePath}`,
      ingestRunId: `benchmark-${Date.now()}`,
      observedAt: Date.now()
    },
    metadata: {
      sourceKind: filePath.toLowerCase().endsWith('.pdf') ? 'pdf' : 'text'
    }
  }
}

function scoreOne(args: {
  filePath: string
  parserMode: string
  parserWarnings: string[]
  text: string
  entities: string[]
  relations: GoldenRelation[]
  golden: GoldenAnnotation
}): ImportBenchmarkDocumentResult {
  const expectedEntities = new Set((args.golden.expectedEntities ?? []).map((label) => normalizeLabel(label)))
  const expectedRelations = new Set(
    (args.golden.expectedRelations ?? []).map(
      (rel) => `${normalizeLabel(rel.from)}|${rel.predicate}|${normalizeLabel(rel.to)}`
    )
  )
  const mustReject = new Set((args.golden.mustReject ?? []).map((label) => normalizeLabel(label)))
  const extractedEntitySet = new Set(args.entities.map((label) => normalizeLabel(label)))
  const extractedRelationSet = new Set(
    args.relations.map((rel) => `${normalizeLabel(rel.from)}|${rel.predicate}|${normalizeLabel(rel.to)}`)
  )

  const entityTruePositives = [...extractedEntitySet].filter((label) => expectedEntities.has(label)).length
  const relationTruePositives = [...extractedRelationSet].filter((rel) => expectedRelations.has(rel)).length
  const mustRejectFalsePositives = [...extractedEntitySet].filter((label) => mustReject.has(label)).length

  return {
    id: randomUUID(),
    filePath: args.filePath,
    parserMode: args.parserMode,
    parserWarnings: args.parserWarnings,
    textLength: args.text.length,
    expectedEntities: expectedEntities.size,
    extractedEntities: extractedEntitySet.size,
    entityPrecision: safeDiv(entityTruePositives, Math.max(1, extractedEntitySet.size)),
    entityRecall: safeDiv(entityTruePositives, Math.max(1, expectedEntities.size)),
    relationPrecision: safeDiv(relationTruePositives, Math.max(1, extractedRelationSet.size)),
    relationRecall: safeDiv(relationTruePositives, Math.max(1, expectedRelations.size)),
    mustRejectFalsePositiveRate: safeDiv(mustRejectFalsePositives, Math.max(1, mustReject.size)),
    parserHardFailure: args.text.trim().length === 0
  }
}

export async function runDocumentImportBenchmark(corpusPath: string): Promise<ImportBenchmarkSummary> {
  const files = listDocumentFiles(corpusPath)
  const results: ImportBenchmarkDocumentResult[] = []
  for (const filePath of files) {
    const bytes = readFileSync(filePath)
    const parsed = await parseDocumentFromBytes({
      fileName: filePath,
      bytes
    })
    const record = buildCanonicalRecord(filePath, parsed.normalizedText)
    const mapped = mapCanonicalRecordToOntology(record)
    const scored = scoreOne({
      filePath,
      parserMode: parsed.parserMode,
      parserWarnings: parsed.warnings,
      text: parsed.normalizedText,
      entities: mapped.entities.map((entity) => entity.label),
      relations: mapped.relations.map((relation) => ({
        from: relation.fromEntityLabel,
        predicate: relation.predicate,
        to: relation.toEntityLabel
      })),
      golden: readGolden(filePath)
    })
    results.push(scored)
  }

  const aggregates = results.reduce(
    (acc, row) => {
      acc.entityPrecision += row.entityPrecision
      acc.entityRecall += row.entityRecall
      acc.relationPrecision += row.relationPrecision
      acc.relationRecall += row.relationRecall
      acc.mustRejectFalsePositiveRate += row.mustRejectFalsePositiveRate
      acc.parserHardFailureRate += row.parserHardFailure ? 1 : 0
      return acc
    },
    {
      entityPrecision: 0,
      entityRecall: 0,
      relationPrecision: 0,
      relationRecall: 0,
      mustRejectFalsePositiveRate: 0,
      parserHardFailureRate: 0
    }
  )
  const denom = Math.max(1, results.length)

  return {
    corpusPath,
    generatedAt: Date.now(),
    documents: results.length,
    entityPrecision: Number((aggregates.entityPrecision / denom).toFixed(4)),
    entityRecall: Number((aggregates.entityRecall / denom).toFixed(4)),
    relationPrecision: Number((aggregates.relationPrecision / denom).toFixed(4)),
    relationRecall: Number((aggregates.relationRecall / denom).toFixed(4)),
    mustRejectFalsePositiveRate: Number((aggregates.mustRejectFalsePositiveRate / denom).toFixed(4)),
    parserHardFailureRate: Number((aggregates.parserHardFailureRate / denom).toFixed(4)),
    results
  }
}
