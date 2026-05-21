import { createHash, randomUUID } from 'crypto'
import type { CanonicalIngestRecord, IngestProvenance, KbImportDiagnostic } from '@shared/types'

type AdapterSourceType = IngestProvenance['sourceType']

function digestBody(body: string): string {
  return createHash('sha1').update(body, 'utf8').digest('hex')
}

function buildProvenance(args: {
  sourceSystem: string
  sourceType: AdapterSourceType
  sourceRecordId: string
  sourceUri?: string
  body: string
  ingestRunId: string
}): IngestProvenance {
  return {
    sourceSystem: args.sourceSystem,
    sourceType: args.sourceType,
    sourceRecordId: args.sourceRecordId,
    sourceUri: args.sourceUri,
    sourceChecksum: digestBody(args.body),
    ingestRunId: args.ingestRunId,
    observedAt: Date.now()
  }
}

export function fromTextSource(input: {
  title: string
  uri: string
  body: string
  heading?: string
  conversationId?: string | null
  ingestRunId?: string
}): CanonicalIngestRecord {
  const ingestRunId = input.ingestRunId ?? randomUUID()
  return {
    id: randomUUID(),
    recordType: 'document',
    title: input.title,
    body: input.body,
    heading: input.heading,
    conversationId: input.conversationId ?? null,
    provenance: buildProvenance({
      sourceSystem: 'kb',
      sourceType: 'text',
      sourceRecordId: input.uri || input.title,
      sourceUri: input.uri,
      body: input.body,
      ingestRunId
    })
  }
}

export function fromFileSource(input: {
  title: string
  filePath: string
  body: string
  sourceKind: 'pdf' | 'text'
  diagnostics?: Partial<KbImportDiagnostic>
  ingestRunId?: string
}): CanonicalIngestRecord {
  const ingestRunId = input.ingestRunId ?? randomUUID()
  return {
    id: randomUUID(),
    recordType: 'document',
    title: input.title,
    body: input.body,
    provenance: buildProvenance({
      sourceSystem: 'kb',
      sourceType: 'file',
      sourceRecordId: input.filePath,
      sourceUri: `file://${input.filePath}`,
      body: input.body,
      ingestRunId
    }),
    metadata: {
      sourceKind: input.sourceKind,
      parserWarnings: Number(input.diagnostics?.parserWarnings?.length ?? 0),
      cleanupEdits: Number(input.diagnostics?.cleanupEdits ?? 0),
      truncated: input.diagnostics?.truncated === true,
      parserEngine: input.diagnostics?.parserEngine ?? '',
      parserMode: input.diagnostics?.parserMode ?? '',
      extractionVersion: input.diagnostics?.extractionVersion ?? 'v1'
    }
  }
}
