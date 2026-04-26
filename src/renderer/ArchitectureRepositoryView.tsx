import asciidoctorFactory from '@asciidoctor/core'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { ArchitectureRepositoryScanResult } from '@shared/architectureRepository'
import type { CodebaseRecord, FormalVerificationRun } from '@shared/codebaseRegistry'
import type { CodebaseAnalysisSnapshot, HardwareSummary, WikiTopic } from '@shared/types'
import {
  renderObservedArchitectureEvidence,
  type ArchitectureEvidenceProps
} from './architectureRepositoryEvidence'
import { MermaidDiagram } from './MermaidDiagram'
import { ArchRepositoryOverviewDiagram } from './ArchRepositoryOverviewDiagram'
import {
  TOGAF_REPOSITORY_MARKDOWN,
  TOGAF_REPOSITORY_NAV_GROUPS,
  TOGAF_REPOSITORY_DEFAULT_ARTIFACT,
  TOGAF_REPOSITORY_CHANGED_ARTIFACTS,
  TOGAF_REPOSITORY_CHANGESET_VERSION,
  findGroupIdForArtifact,
  type TogafRepositoryArtifactId
} from './togafRepositoryArtifacts'

marked.use({ gfm: true, breaks: false })

let asciidoctorInstance: ReturnType<typeof asciidoctorFactory> | null = null
function getAsciidoctor(): ReturnType<typeof asciidoctorFactory> {
  if (!asciidoctorInstance) asciidoctorInstance = asciidoctorFactory()
  return asciidoctorInstance
}

function initialChapterOpenState(): Record<string, boolean> {
  const sel = TOGAF_REPOSITORY_DEFAULT_ARTIFACT
  const o: Record<string, boolean> = {}
  for (const g of TOGAF_REPOSITORY_NAV_GROUPS) {
    o[g.groupId] = g.items.some((i) => i.id === sel)
  }
  return o
}

type MdSegment = { kind: 'html'; html: string } | { kind: 'mermaid'; code: string; key: string }

function looksLikeAsciiDoc(s: string): boolean {
  const head = s.slice(0, Math.min(s.length, 12_000))
  if (/^={1,6}\s+\S/m.test(head)) return true
  if (/\[source[,\]]/m.test(head)) return true
  if (/^\.[A-Za-z][^\n]*\n/m.test(head)) return true
  if (/image::[^\s\[]+/m.test(head)) return true
  if (/include::[^\s\[]+/m.test(head)) return true
  if (/^:[-a-z0-9]+:\s+/im.test(head)) return true
  if (/\b(?:stem|latexmath|asciimath):\[/m.test(head)) return true
  if (/^\[(?:stem|latexmath)\]/m.test(head)) return true
  return false
}

function renderAsciiDocToSafeHtml(content: string): string {
  try {
    const adoc = getAsciidoctor()
    const out = adoc.convert(content, { safe: 'secure', attributes: { stem: 'latexmath' } })
    return DOMPurify.sanitize(typeof out === 'string' ? out : '')
  } catch {
    const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    return DOMPurify.sanitize(`<pre>${escaped}</pre>`)
  }
}

function splitMarkdownMermaid(markdown: string): MdSegment[] {
  const segments: MdSegment[] = []
  // Accept common aliases so chapter subpages can use diagram fences naturally.
  const re = /```(?:mermaid|mmd|diagram|diagrams|diagramm)\s*\n([\s\S]*?)```/gi
  let last = 0
  let m: RegExpExecArray | null
  let idx = 0
  while ((m = re.exec(markdown)) !== null) {
    if (m.index > last) {
      const md = markdown.slice(last, m.index)
      if (md.trim()) {
        const raw = marked.parse(md, { async: false })
        const html = DOMPurify.sanitize(typeof raw === 'string' ? raw : '')
        segments.push({ kind: 'html', html })
      }
    }
    segments.push({ kind: 'mermaid', code: m[1].trim(), key: `m-${idx++}` })
    last = m.index + m[0].length
  }
  if (last < markdown.length) {
    const md = markdown.slice(last)
    if (md.trim()) {
      const raw = marked.parse(md, { async: false })
      const html = DOMPurify.sanitize(typeof raw === 'string' ? raw : '')
      segments.push({ kind: 'html', html })
    }
  }
  if (segments.length === 0) {
    const raw = marked.parse(markdown, { async: false })
    segments.push({ kind: 'html', html: DOMPurify.sanitize(typeof raw === 'string' ? raw : '') })
  }
  return segments
}

function RepositoryMarkdown(props: {
  markdown: string
  className?: string
  formatHint?: GeneratedDocFormat | null
}): ReactElement {
  const isAsciiDoc = useMemo(
    () => props.formatHint === 'asciidoc' || (props.formatHint == null && looksLikeAsciiDoc(props.markdown)),
    [props.formatHint, props.markdown]
  )
  const parts = useMemo(() => {
    if (isAsciiDoc) {
      const html = renderAsciiDocToSafeHtml(props.markdown)
      return [{ kind: 'html', html } as MdSegment]
    }
    return splitMarkdownMermaid(props.markdown)
  }, [isAsciiDoc, props.markdown])
  return (
      <div className={['arch-repo-markdown', props.className].filter(Boolean).join(' ')}>
      {parts.map((p, i) =>
        p.kind === 'html' ? (
          <div
            key={`html-${i}`}
            className="arch-repo-md-chunk mw-parser-output"
            dangerouslySetInnerHTML={{ __html: p.html }}
          />
        ) : (
          <MermaidDiagram key={`${p.key}-${i}`} source={p.code} className="arch-repo-mermaid-block" />
        )
      )}
    </div>
  )
}

function findNavItemById(id: TogafRepositoryArtifactId): {
  groupTitle: string
  itemLabel: string
  admHint: string
} | null {
  for (const group of TOGAF_REPOSITORY_NAV_GROUPS) {
    const item = group.items.find((x) => x.id === id)
    if (item) {
      return {
        groupTitle: group.groupTitle,
        itemLabel: item.label,
        admHint: item.admHint
      }
    }
  }
  return null
}

function preambleEvidenceFocus(id: TogafRepositoryArtifactId): string {
  if (id === 'application_architecture_catalog') return 'Selected codebase scan and communication heuristics'
  if (id === 'repo_architecture_landscape') return 'Cross-codebase inventory hints and scan summaries'
  if (id === 'business_architecture_catalog') return 'Knowledge-base topics and extracted analysis snapshots'
  if (id === 'data_architecture_catalog') return 'Knowledge graph structure and ingestion-derived relationships'
  if (id === 'technology_architecture_catalog') return 'Runtime, integration, and workstation observations'
  if (id === 'architecture_governance_log' || id === 'adm_phase_g_implementation_governance') {
    return 'Governance signals from bridge activity and formal runs'
  }
  if (id === 'architecture_repository_overview') return 'Cross-domain snapshot for the selected architecture subject'
  return 'TOGAF-aligned chapter evidence linked to selected codebase context'
}

const REPOSITORY_SPECIFIC_CHAPTERS = new Set<TogafRepositoryArtifactId>([
  'application_architecture_catalog',
  'repo_architecture_landscape',
  'building_blocks_abb_sbb'
])

function chapterUsesRepositoryScope(id: TogafRepositoryArtifactId): boolean {
  return REPOSITORY_SPECIFIC_CHAPTERS.has(id)
}

function isDecisionRecordChapter(id: TogafRepositoryArtifactId): boolean {
  return id === 'architecture_governance_log' || id === 'adm_phase_g_implementation_governance'
}

type DecisionRecordSummary = {
  adrId: string
  title: string
  status?: string
  date?: string
  owner?: string
}

function parseDecisionRecordSummaries(content: string): DecisionRecordSummary[] {
  const rows: DecisionRecordSummary[] = []
  const re = /^(?:##+\s*|==+\s*)(ADR[-\s]?\d+)\s*[:\-]?\s*(.+)?$/gim
  const matches = [...content.matchAll(re)]
  if (matches.length === 0) return rows
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    const start = m.index ?? 0
    const end = i + 1 < matches.length ? matches[i + 1].index ?? content.length : content.length
    const block = content.slice(start, end)
    const adrId = (m[1] ?? '').replace(/\s+/g, '-').toUpperCase()
    const title = (m[2] ?? '').trim() || 'Decision'
    const statusTable = block.match(/\|\s*Status\s*\|\s*([^\|\n]+)\|/i)?.[1]?.trim()
    const dateTable = block.match(/\|\s*Date\s*\|\s*([^\|\n]+)\|/i)?.[1]?.trim()
    const ownerTable = block.match(/\|\s*Decision owner\s*\|\s*([^\|\n]+)\|/i)?.[1]?.trim()
    const statusAttr = block.match(/^:status:\s*(.+)$/im)?.[1]?.trim()
    const dateAttr = block.match(/^:date:\s*(.+)$/im)?.[1]?.trim()
    const ownerAttr = block.match(/^:owner:\s*(.+)$/im)?.[1]?.trim()
    rows.push({
      adrId,
      title,
      status: statusTable || statusAttr,
      date: dateTable || dateAttr,
      owner: ownerTable || ownerAttr
    })
  }
  return rows
}

function DecisionRecordLayoutPanel(props: {
  chapterLabel: string
  chapterHint: string
  chapterContent: string
  onNavigateToDecision: (adrId: string) => void
}): ReactElement {
  const markdownTemplate = `## ADR-XXX: Decision title

| Field | Value |
| --- | --- |
| Status | Proposed |
| Date | YYYY-MM-DD |
| Decision owner | Team / role |
| Scope | Repository or portfolio |
| Tags | security, data, integration |

### Context
What problem or constraint is driving this decision?

### Decision
What was decided?

### Consequences
- Positive impact
- Trade-off / risk

---

### Verification / follow-up
- [ ] Validation task 1
- [ ] Validation task 2`

  const asciidocTemplate = `== ADR-XXX: Decision title
:status: Proposed
:date: YYYY-MM-DD
:owner: Team / role
:scope: Repository or portfolio
:tags: security,data,integration

[cols="1,3",options="header"]
|===
|Field |Value
|Status |{status}
|Date |{date}
|Decision owner |{owner}
|Scope |{scope}
|Tags |{tags}
|===

=== Context
What problem or constraint is driving this decision?

=== Decision
What was decided?

=== Consequences
* Positive impact
* Trade-off / risk

'''

=== Verification / follow-up
* [ ] Validation task 1
* [ ] Validation task 2`

  const records = useMemo(() => parseDecisionRecordSummaries(props.chapterContent), [props.chapterContent])

  return (
    <section className="arch-repo-decision-layout panel-like" aria-label="Decision record layout">
      <h3 className="settings-section-title">
        <i className="fa-solid fa-clipboard-check" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
        Decision record layout
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Use this dedicated ADR format for <strong>{props.chapterLabel}</strong> ({props.chapterHint}).
      </p>
      <table className="arch-repo-table">
        <tbody>
          <tr>
            <th scope="row">Record key</th>
            <td>
              <code className="inline-code">ADR-XXX</code> (incremental sequence)
            </td>
          </tr>
          <tr>
            <th scope="row">Required fields</th>
            <td>Status, Date, Decision owner, Scope, Context, Decision, Consequences</td>
          </tr>
          <tr>
            <th scope="row">Optional fields</th>
            <td>Tags, related requirements, rollback trigger, verification checklist</td>
          </tr>
          <tr>
            <th scope="row">Decision status set</th>
            <td>Proposed, Accepted, Superseded, Rejected</td>
          </tr>
        </tbody>
      </table>
      {records.length > 0 ? (
        <>
          <h4 className="arch-repo-subheading" style={{ marginTop: 10 }}>Decision register (navigable)</h4>
          <table className="arch-repo-table">
            <thead>
              <tr>
                <th>ADR</th>
                <th>Title</th>
                <th>Status</th>
                <th>Date</th>
                <th>Owner</th>
                <th>Jump</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.adrId}>
                  <td>
                    <code className="inline-code">{r.adrId}</code>
                  </td>
                  <td>{r.title}</td>
                  <td>{r.status ?? '—'}</td>
                  <td>{r.date ?? '—'}</td>
                  <td>{r.owner ?? '—'}</td>
                  <td>
                    <button type="button" className="btn-secondary" onClick={() => props.onNavigateToDecision(r.adrId)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="muted" style={{ marginTop: 10 }}>
          No ADR entries detected yet. Add records using headings like <code className="inline-code">## ADR-001: ...</code> or{' '}
          <code className="inline-code">== ADR-001: ...</code> to populate the register.
        </p>
      )}
      <h4 className="arch-repo-subheading" style={{ marginTop: 10 }}>Markdown ADR template</h4>
      <pre className="arch-repo-code-fence">{markdownTemplate}</pre>
      <h4 className="arch-repo-subheading" style={{ marginTop: 10 }}>AsciiDoc ADR template</h4>
      <pre className="arch-repo-code-fence" style={{ marginBottom: 0 }}>{asciidocTemplate}</pre>
    </section>
  )
}

function buildChapterGenerationContext(p: {
  artifact: TogafRepositoryArtifactId
  chapterLabel: string
  chapterHint: string
  baseMarkdown: string
  sourceMode: 'repository_specific' | 'all_repositories'
  sourceSubjects: { name: string; root: string }[]
  scanResults: ArchitectureRepositoryScanResult[]
  relatedRuns: FormalVerificationRun[]
  relatedSnapshots: CodebaseAnalysisSnapshot[]
}): string {
  const scanSummary =
    p.scanResults.length === 0
      ? 'No scan result available.'
      : JSON.stringify(
          p.scanResults.slice(0, 8).map((sr) => ({
            root: sr.root,
            generatedAt: sr.generatedAt,
            truncated: sr.truncated,
            fileCount: sr.fileCount,
            directoryCount: sr.directoryCount,
            linesSampled: sr.linesSampled,
            topLevelNames: sr.topLevelNames.slice(0, 24),
            integrationSurfaceDirs: sr.integrationSurfaceDirs.slice(0, 16),
            notableRelativePaths: sr.notableRelativePaths.slice(0, 24),
            topExtensions: Object.entries(sr.extensions)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 16)
          })),
          null,
          2
        )
  const latestRun = [...p.relatedRuns].sort((a, b) => b.startedAt - a.startedAt)[0]
  const snapshotSummary =
    p.relatedSnapshots.length === 0
      ? 'No codebase analysis snapshots available.'
      : JSON.stringify(
          p.relatedSnapshots.slice(0, 3).map((s) => ({
            id: s.id,
            createdAt: s.createdAt,
            rootPath: s.rootPath,
            domainModelCount: s.domainModel.length,
            designPatternCount: s.designPatterns.length,
            architecturePatternCount: s.architecturePatterns.length
          })),
          null,
          2
        )
  return `Target chapter: ${p.chapterLabel}
Chapter hint: ${p.chapterHint}
TOGAF artifact id: ${p.artifact}
Source mode: ${p.sourceMode}
Source repositories:
${JSON.stringify(p.sourceSubjects, null, 2)}

Current chapter baseline markdown:
${p.baseMarkdown}

Observed scan summary:
${scanSummary}

Formal verification summary:
runCount=${p.relatedRuns.length}
latestRunStatus=${latestRun?.status ?? 'none'}

Codebase analysis snapshot summary:
${snapshotSummary}`
}

function formatExtTable(ext: Record<string, number>): ReactElement {
  const rows = Object.entries(ext)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
  if (rows.length === 0) return <p className="muted">No file extensions collected.</p>
  return (
    <table className="arch-repo-table">
      <thead>
        <tr>
          <th>Extension</th>
          <th>Files (bounded scan)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td>
              <code className="inline-code">{k}</code>
            </td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export type ArchitectureRepositoryViewProps = {
  scanRoot: string | null
  onChooseScanRoot: () => Promise<void>
  onClearScanRoot: () => Promise<void>
  integrationListenEnabled: boolean
  integrationPort: number
  integrationTokenConfigured: boolean
  wikiTopics: WikiTopic[]
  kgNodeCount: number
  kgEdgeCount: number
  kgLoading: boolean
  kgTruncated: boolean
  onRefreshKnowledgeGraph: () => void
  hardwareSummary: HardwareSummary | null
  modelsDefaultPath: string | null
  trainJobCount: number
  pluginReportCount: number
  codebaseAnalysisSnapshots: CodebaseAnalysisSnapshot[]
}

function codebaseLabel(c: CodebaseRecord): string {
  return c.displayName?.trim() || c.linkedIdeProjectName?.trim() || c.rootPath
}

function rootsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = (a ?? '').trim().replace(/\\/g, '/').toLowerCase()
  const nb = (b ?? '').trim().replace(/\\/g, '/').toLowerCase()
  return na.length > 0 && na === nb
}

const VIEWED_TOGAF_CHANGES_KEY = `archRepoViewedChanges:${TOGAF_REPOSITORY_CHANGESET_VERSION}`
const GENERATED_CHAPTERS_SCHEMA_VERSION = 1
const MAX_GENERATED_CHAPTER_VERSIONS = 20

type GeneratedChapterVersion = {
  version: number
  createdAt: number
  markdown: string
  format?: 'markdown' | 'asciidoc'
  modelPath?: string
  artifactId?: string
  subjectKey?: string
}

type GeneratedChapterHistory = {
  activeVersion: number
  versions: GeneratedChapterVersion[]
}

type GeneratedChapterStore = Record<string, GeneratedChapterHistory>
type GeneratedDocFormat = 'markdown' | 'asciidoc'

function readViewedChangeSet(): Set<TogafRepositoryArtifactId> {
  try {
    const raw = window.localStorage.getItem(VIEWED_TOGAF_CHANGES_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    const allowed = new Set<TogafRepositoryArtifactId>(TOGAF_REPOSITORY_CHANGED_ARTIFACTS)
    const out = new Set<TogafRepositoryArtifactId>()
    for (const x of parsed) {
      if (typeof x === 'string' && allowed.has(x as TogafRepositoryArtifactId)) {
        out.add(x as TogafRepositoryArtifactId)
      }
    }
    return out
  } catch {
    return new Set()
  }
}

function persistViewedChangeSet(set: Set<TogafRepositoryArtifactId>): void {
  try {
    window.localStorage.setItem(VIEWED_TOGAF_CHANGES_KEY, JSON.stringify([...set]))
  } catch {
    /* ignore storage failures */
  }
}

function toGenerationSubjectKey(
  chapterId: TogafRepositoryArtifactId,
  codebase: CodebaseRecord | null,
  scanRoot: string | null
): string {
  if (!chapterUsesRepositoryScope(chapterId)) return 'all_repositories'
  if (codebase?.id) return `codebase:${codebase.id}`
  if (scanRoot?.trim()) return `root:${scanRoot.trim().replace(/\\/g, '/')}`
  return 'workspace'
}

function toGenerationKey(artifact: TogafRepositoryArtifactId, subjectKey: string): string {
  return `${artifact}::${subjectKey}`
}

function parseGeneratedChapterStore(raw: unknown): GeneratedChapterStore {
  if (!raw || typeof raw !== 'object') return {}
  const out: GeneratedChapterStore = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || !v || typeof v !== 'object') continue
    const hist = v as Record<string, unknown>
    const activeVersion = typeof hist.activeVersion === 'number' ? Math.trunc(hist.activeVersion) : 0
    const versionsRaw = Array.isArray(hist.versions) ? hist.versions : []
    const versions: GeneratedChapterVersion[] = []
    for (const it of versionsRaw) {
      if (!it || typeof it !== 'object') continue
      const row = it as Record<string, unknown>
      const version = typeof row.version === 'number' ? Math.trunc(row.version) : 0
      const createdAt = typeof row.createdAt === 'number' ? Math.trunc(row.createdAt) : 0
      const markdown = typeof row.markdown === 'string' ? row.markdown : ''
      if (version < 1 || createdAt < 1 || !markdown.trim()) continue
      versions.push({
        version,
        createdAt,
        markdown,
        format: row.format === 'asciidoc' ? 'asciidoc' : row.format === 'markdown' ? 'markdown' : undefined,
        modelPath: typeof row.modelPath === 'string' ? row.modelPath : undefined,
        artifactId: typeof row.artifactId === 'string' ? row.artifactId : undefined,
        subjectKey: typeof row.subjectKey === 'string' ? row.subjectKey : undefined
      })
    }
    if (versions.length === 0) continue
    versions.sort((a, b) => a.version - b.version)
    const fallbackActive = versions[versions.length - 1].version
    const normalizedActive = versions.some((x) => x.version === activeVersion) ? activeVersion : fallbackActive
    out[k] = { activeVersion: normalizedActive, versions }
  }
  return out
}

function activeGeneratedVersion(store: GeneratedChapterStore, key: string): GeneratedChapterVersion | null {
  const hist = store[key]
  if (!hist) return null
  return hist.versions.find((x) => x.version === hist.activeVersion) ?? hist.versions[hist.versions.length - 1] ?? null
}

function normalizeModelDraft(raw: string): { format: GeneratedDocFormat; content: string } {
  const t = raw.trim()
  if (!t) throw new Error('Model returned empty content.')
  const mdFence = t.match(/^```(?:markdown|md)\s*\n([\s\S]*?)\n?```$/i)
  if (mdFence) {
    const content = mdFence[1].trim()
    if (!content) throw new Error('Markdown payload inside fence is empty.')
    marked.parse(content, { async: false })
    return { format: 'markdown', content }
  }
  const adocFence = t.match(/^```(?:asciidoc|adoc)\s*\n([\s\S]*?)\n?```$/i)
  if (adocFence) {
    const content = adocFence[1].trim()
    if (!content) throw new Error('AsciiDoc payload inside fence is empty.')
    const html = renderAsciiDocToSafeHtml(content)
    if (!html.trim()) throw new Error('AsciiDoc conversion returned empty output.')
    return { format: 'asciidoc', content }
  }
  if (looksLikeAsciiDoc(t)) {
    const html = renderAsciiDocToSafeHtml(t)
    if (!html.trim()) throw new Error('AsciiDoc conversion returned empty output.')
    return { format: 'asciidoc', content: t }
  }
  marked.parse(t, { async: false })
  return { format: 'markdown', content: t }
}

export function ArchitectureRepositoryView(props: ArchitectureRepositoryViewProps): ReactElement {
  const [selected, setSelected] = useState<TogafRepositoryArtifactId>(TOGAF_REPOSITORY_DEFAULT_ARTIFACT)
  const [chapterOpen, setChapterOpen] = useState<Record<string, boolean>>(initialChapterOpenState)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanErr, setScanErr] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ArchitectureRepositoryScanResult | null>(null)
  const [preambleOpen, setPreambleOpen] = useState(false)
  const [generateBusy, setGenerateBusy] = useState(false)
  const [saveVersionBusy, setSaveVersionBusy] = useState(false)
  const [generateErr, setGenerateErr] = useState<string | null>(null)
  const [generateInfo, setGenerateInfo] = useState<string | null>(null)
  const [generateProgressPhase, setGenerateProgressPhase] = useState<string | null>(null)
  const [generateProgressPercent, setGenerateProgressPercent] = useState(0)
  const [generateTokenChunks, setGenerateTokenChunks] = useState(0)
  const [generateProgressPreview, setGenerateProgressPreview] = useState('')
  const [generateProgressTokens, setGenerateProgressTokens] = useState<{ prompt?: number; completion?: number } | null>(null)
  const [rollbackVersion, setRollbackVersion] = useState<number | ''>('')
  const [generatedChapterStore, setGeneratedChapterStore] = useState<GeneratedChapterStore>({})
  const [viewedChangeSet, setViewedChangeSet] = useState<Set<TogafRepositoryArtifactId>>(() => readViewedChangeSet())
  const [codebases, setCodebases] = useState<CodebaseRecord[]>([])
  const [selectedCodebaseId, setSelectedCodebaseId] = useState<string>('')
  const [formalRuns, setFormalRuns] = useState<FormalVerificationRun[]>([])
  const detailRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const loadCodebaseContext = async () => {
      try {
        const [bundle, runs, cfg] = await Promise.all([
          window.api.codebaseFormalGet(),
          window.api.codebaseFormalRunList(),
          window.api.getConfig()
        ])
        if (cancelled) return
        setCodebases(bundle.codebases)
        setFormalRuns(runs)
        setGeneratedChapterStore(parseGeneratedChapterStore(cfg.architectureRepositoryGeneratedChapters))
      } catch {
        if (cancelled) return
        setCodebases([])
        setFormalRuns([])
        setGeneratedChapterStore({})
      }
    }
    void loadCodebaseContext()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCodebase = useMemo(() => {
    if (selectedCodebaseId) {
      const explicit = codebases.find((c) => c.id === selectedCodebaseId)
      if (explicit) return explicit
    }
    if (props.scanRoot) {
      const matched = codebases.find((c) => rootsEqual(c.rootPath, props.scanRoot))
      if (matched) return matched
    }
    return codebases.find((c) => !c.disabled) ?? codebases[0] ?? null
  }, [codebases, props.scanRoot, selectedCodebaseId])

  const effectiveScanRoot = selectedCodebase?.rootPath ?? props.scanRoot
  const chapterRepoSpecific = chapterUsesRepositoryScope(selected)
  const generationSubjectKey = toGenerationSubjectKey(selected, selectedCodebase, effectiveScanRoot)
  const generationKey = toGenerationKey(selected, generationSubjectKey)
  const currentDraftHistory = generatedChapterStore[generationKey] ?? null
  const selectedNavMeta = useMemo(() => findNavItemById(selected), [selected])
  const baseChapterMarkdown = TOGAF_REPOSITORY_MARKDOWN[selected]
  const activeGeneratedDraft = activeGeneratedVersion(generatedChapterStore, generationKey)
  const chapterMarkdownToRender = activeGeneratedDraft?.markdown ?? baseChapterMarkdown

  useEffect(() => {
    setRollbackVersion(activeGeneratedDraft?.version ?? '')
  }, [activeGeneratedDraft?.version, generationKey])

  const runScan = useCallback(async () => {
    if (!effectiveScanRoot) {
      setScanResult(null)
      setScanErr('No architecture subject selected. Choose a registered codebase or pick a workspace folder.')
      return
    }
    setScanBusy(true)
    setScanErr(null)
    try {
      const r = await window.api.architectureRepositoryScan({ rootPath: effectiveScanRoot })
      if (!r.ok) {
        setScanResult(null)
        setScanErr(r.error)
        return
      }
      setScanResult(r.result)
    } catch (e) {
      setScanResult(null)
      setScanErr(e instanceof Error ? e.message : String(e))
    } finally {
      setScanBusy(false)
    }
  }, [effectiveScanRoot])

  const markChangeViewed = useCallback((id: TogafRepositoryArtifactId) => {
    if (!TOGAF_REPOSITORY_CHANGED_ARTIFACTS.includes(id)) return
    setViewedChangeSet((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      persistViewedChangeSet(next)
      return next
    })
  }, [])

  useEffect(() => {
    markChangeViewed(selected)
  }, [markChangeViewed, selected])

  const toggleChapter = useCallback((groupId: string) => {
    const g = TOGAF_REPOSITORY_NAV_GROUPS.find((x) => x.groupId === groupId)
    if (!g) return
    const containsSelected = g.items.some((i) => i.id === selected)
    setChapterOpen((prev) => {
      const cur = prev[groupId] ?? false
      if (cur && containsSelected) return prev
      return { ...prev, [groupId]: !cur }
    })
  }, [selected])

  const navigateToArtifact = useCallback((id: TogafRepositoryArtifactId) => {
    const gid = findGroupIdForArtifact(id)
    if (gid) {
      setChapterOpen((p) => ({ ...p, [gid]: true }))
    }
    setSelected(id)
  }, [])

  const evidenceProps: ArchitectureEvidenceProps = useMemo(
    () => ({
      integrationListenEnabled: props.integrationListenEnabled,
      integrationPort: props.integrationPort,
      integrationTokenConfigured: props.integrationTokenConfigured,
      wikiTopics: props.wikiTopics,
      kgNodeCount: props.kgNodeCount,
      kgEdgeCount: props.kgEdgeCount,
      kgLoading: props.kgLoading,
      kgTruncated: props.kgTruncated,
      onRefreshKnowledgeGraph: props.onRefreshKnowledgeGraph,
      hardwareSummary: props.hardwareSummary,
      modelsDefaultPath: props.modelsDefaultPath,
      scanRoot: props.scanRoot,
      selectedCodebase,
      scanResult,
      formalRuns,
      trainJobCount: props.trainJobCount,
      pluginReportCount: props.pluginReportCount,
      codebaseAnalysisSnapshots: props.codebaseAnalysisSnapshots
    }),
    [
      props.integrationListenEnabled,
      props.integrationPort,
      props.integrationTokenConfigured,
      props.wikiTopics,
      props.kgNodeCount,
      props.kgEdgeCount,
      props.kgLoading,
      props.kgTruncated,
      props.onRefreshKnowledgeGraph,
      props.hardwareSummary,
      props.modelsDefaultPath,
      props.scanRoot,
      selectedCodebase,
      props.trainJobCount,
      props.pluginReportCount,
      props.codebaseAnalysisSnapshots,
      scanResult,
      formalRuns
    ]
  )

  const observedEvidencePanel = useMemo(
    () => renderObservedArchitectureEvidence(selected, evidenceProps),
    [selected, evidenceProps]
  )

  const persistGeneratedStore = useCallback(async (next: GeneratedChapterStore): Promise<void> => {
    const r = await window.api.setConfig({
      architectureRepositoryGeneratedChaptersSchemaVersion: GENERATED_CHAPTERS_SCHEMA_VERSION,
      architectureRepositoryGeneratedChapters: next
    })
    if (!r.ok) throw new Error(r.error ?? 'Could not persist generated chapter drafts')
  }, [])

  const saveGeneratedDraftVersion = useCallback(
    async (markdown: string, modelPath: string | undefined, format: GeneratedDocFormat) => {
      const prev = generatedChapterStore[generationKey]
      const latestVersion = prev?.versions[prev.versions.length - 1]?.version ?? 0
      const nextVersion: GeneratedChapterVersion = {
        version: latestVersion + 1,
        createdAt: Date.now(),
        markdown,
        format,
        modelPath,
        artifactId: selected,
        subjectKey: generationSubjectKey
      }
      const versions = [...(prev?.versions ?? []), nextVersion].slice(-MAX_GENERATED_CHAPTER_VERSIONS)
      const next: GeneratedChapterStore = {
        ...generatedChapterStore,
        [generationKey]: {
          activeVersion: nextVersion.version,
          versions
        }
      }
      await persistGeneratedStore(next)
      setGeneratedChapterStore(next)
      return nextVersion
    },
    [generatedChapterStore, generationKey, generationSubjectKey, persistGeneratedStore, selected]
  )

  const rollbackGeneratedDraft = useCallback(
    async (targetVersion: number) => {
      const hist = generatedChapterStore[generationKey]
      if (!hist) return
      if (!hist.versions.some((v) => v.version === targetVersion)) return
      const next: GeneratedChapterStore = {
        ...generatedChapterStore,
        [generationKey]: {
          ...hist,
          activeVersion: targetVersion
        }
      }
      await persistGeneratedStore(next)
      setGeneratedChapterStore(next)
    },
    [generatedChapterStore, generationKey, persistGeneratedStore]
  )

  const generateChapterDraft = useCallback(async () => {
    setGenerateErr(null)
    setGenerateInfo(null)
    setGenerateProgressPhase('Preparing context')
    setGenerateProgressPercent(6)
    setGenerateTokenChunks(0)
    setGenerateProgressPreview('')
    setGenerateProgressTokens(null)
    if (chapterRepoSpecific && !effectiveScanRoot) {
      setGenerateErr('Select a codebase (or scan root) before generating chapter documentation.')
      setGenerateProgressPhase(null)
      return
    }
    setGenerateBusy(true)
    try {
      const status = await window.api.runtimeStatus()
      if (!status?.running || !status.modelPath?.trim()) {
        throw new Error('No loaded model detected. Start a runtime/model first, then generate the chapter.')
      }
      setGenerateProgressPercent((p) => (p < 12 ? 12 : p))

      const sourceSubjects: { name: string; root: string }[] = chapterRepoSpecific
        ? [
            {
              name: selectedCodebase ? codebaseLabel(selectedCodebase) : effectiveScanRoot ?? 'Selected repository',
              root: effectiveScanRoot ?? ''
            }
          ]
        : codebases.filter((c) => !c.disabled).map((c) => ({ name: codebaseLabel(c), root: c.rootPath }))

      if (!chapterRepoSpecific && sourceSubjects.length === 0 && effectiveScanRoot) {
        sourceSubjects.push({ name: effectiveScanRoot, root: effectiveScanRoot })
      }
      if (sourceSubjects.length === 0) {
        throw new Error('No repositories available. Register at least one repository before generation.')
      }

      const scanResults: ArchitectureRepositoryScanResult[] = []
      for (let i = 0; i < sourceSubjects.length; i++) {
        const src = sourceSubjects[i]
        setGenerateProgressPhase(
          chapterRepoSpecific
            ? 'Collecting repository evidence'
            : `Collecting repository evidence (${i + 1}/${sourceSubjects.length})`
        )
        const sr = await window.api.architectureRepositoryScan({ rootPath: src.root })
        if (!sr.ok) {
          if (chapterRepoSpecific) throw new Error(sr.error)
          continue
        }
        scanResults.push(sr.result)
        if (chapterRepoSpecific) {
          setScanResult(sr.result)
        }
        const nextPct = Math.min(35, 12 + Math.floor(((i + 1) / sourceSubjects.length) * 23))
        setGenerateProgressPercent((prev) => (nextPct > prev ? nextPct : prev))
      }

      const relatedRuns = chapterRepoSpecific && selectedCodebase
        ? formalRuns.filter((r) => r.codebaseId === selectedCodebase.id)
        : formalRuns
      const relatedSnapshots = chapterRepoSpecific && selectedCodebase
        ? props.codebaseAnalysisSnapshots.filter((s) => s.codebaseId === selectedCodebase.id)
        : props.codebaseAnalysisSnapshots

      const context = buildChapterGenerationContext({
        artifact: selected,
        chapterLabel: selectedNavMeta?.itemLabel ?? selected,
        chapterHint: selectedNavMeta?.admHint ?? 'TOGAF-aligned chapter',
        baseMarkdown: baseChapterMarkdown,
        sourceMode: chapterRepoSpecific ? 'repository_specific' : 'all_repositories',
        sourceSubjects,
        scanResults,
        relatedRuns,
        relatedSnapshots
      })

      const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : ''
      const messages = [
        {
          role: 'system',
          content:
            `You are an enterprise architecture assistant. Generate a TOGAF chapter draft in valid Markdown or valid AsciiDoc (prefer Markdown unless AsciiDoc is explicitly better). Ground claims in provided observations; clearly mark unknowns as assumptions. Prefer concise sections, include at least one table, and include a horizontal rule. Include a mermaid diagram when useful. Output only the document text.${
              isDecisionRecordChapter(selected)
                ? ' For decision-record chapters, use ADR format with explicit fields: ID, Status, Date, Decision owner, Context, Decision, Consequences, and follow-up verification.'
                : ''
            }`
        },
        {
          role: 'user',
          content: context
        }
      ]
      const offProgress = window.api.onRuntimeChatProgress((p) => {
        if (p.requestId !== requestId) return
        if (p.kind === 'started') {
          setGenerateProgressPhase('Model started')
          setGenerateProgressPercent((prev) => Math.max(prev, 20))
          return
        }
        if (p.kind === 'token') {
          if (typeof p.text === 'string' && p.text.length > 0) {
            setGenerateProgressPhase('Generating tokens')
            setGenerateTokenChunks((prev) => {
              const next = prev + 1
              const nextPct = Math.min(88, 22 + Math.floor(next * 0.8))
              setGenerateProgressPercent((cur) => (nextPct > cur ? nextPct : cur))
              return next
            })
            setGenerateProgressPreview((prev) => {
              const next = `${prev}${p.text}`
              return next.length > 1600 ? next.slice(next.length - 1600) : next
            })
          }
          return
        }
        if (p.kind === 'usage') {
          setGenerateProgressTokens({
            prompt: p.promptTokens,
            completion: p.completionTokens
          })
          setGenerateProgressPhase('Finalizing output')
          setGenerateProgressPercent((prev) => Math.max(prev, 95))
          return
        }
        if (p.kind === 'error') {
          setGenerateProgressPhase('Model reported an error')
          if (p.message) setGenerateErr(p.message)
        }
      })
      let raw = ''
      try {
        raw = await window.api.runtimeChat(messages, requestId, { maxTokens: 1700 })
      } finally {
        offProgress()
      }
      const normalized = normalizeModelDraft(raw)
      const saved = await saveGeneratedDraftVersion(normalized.content, status.modelPath.trim(), normalized.format)
      setGenerateInfo(
        `Generated draft v${saved.version} (${normalized.format}) with loaded model: ${status.modelPath.trim()}`
      )
      setGenerateProgressPhase('Completed')
      setGenerateProgressPercent(100)
    } catch (e) {
      setGenerateErr(e instanceof Error ? e.message : String(e))
      setGenerateProgressPhase('Failed')
      setGenerateProgressPercent((p) => (p <= 0 ? 100 : p))
    } finally {
      setGenerateBusy(false)
    }
  }, [
    baseChapterMarkdown,
    chapterRepoSpecific,
    codebases,
    effectiveScanRoot,
    formalRuns,
    props.codebaseAnalysisSnapshots,
    saveGeneratedDraftVersion,
    selected,
    selectedCodebase,
    selectedNavMeta?.admHint,
    selectedNavMeta?.itemLabel
  ])

  const clearGeneratedDraft = useCallback(() => {
    setGenerateErr(null)
    setGenerateInfo(null)
    const hist = generatedChapterStore[generationKey]
    if (!hist) return
    const next = { ...generatedChapterStore }
    delete next[generationKey]
    void persistGeneratedStore(next)
      .then(() => {
        setGeneratedChapterStore(next)
      })
      .catch((e) => {
        setGenerateErr(e instanceof Error ? e.message : String(e))
      })
  }, [generatedChapterStore, generationKey, persistGeneratedStore])

  const saveCurrentChapterAsVersion = useCallback(async () => {
    setGenerateErr(null)
    setGenerateInfo(null)
    setSaveVersionBusy(true)
    try {
      const format: GeneratedDocFormat =
        activeGeneratedDraft?.format ?? (looksLikeAsciiDoc(chapterMarkdownToRender) ? 'asciidoc' : 'markdown')
      const st = await window.api.runtimeStatus()
      const modelLabel = st?.running && st.modelPath?.trim() ? st.modelPath.trim() : 'manual-save'
      const saved = await saveGeneratedDraftVersion(chapterMarkdownToRender, modelLabel, format)
      setGenerateInfo(`Saved chapter as draft v${saved.version} and set it as current.`)
    } catch (e) {
      setGenerateErr(e instanceof Error ? e.message : String(e))
    } finally {
      setSaveVersionBusy(false)
    }
  }, [activeGeneratedDraft?.format, chapterMarkdownToRender, saveGeneratedDraftVersion])

  const navigateToDecision = useCallback((adrId: string) => {
    const root = detailRef.current
    if (!root) return
    const idNorm = adrId.trim().toUpperCase()
    if (!idNorm) return
    const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    const target = headings.find((h) => (h.textContent ?? '').toUpperCase().includes(idNorm))
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const scanWorkspacePanel =
    selected === 'application_architecture_catalog' ? (
      <section className="arch-repo-scan panel-like">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-folder-tree" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
          Application Architecture — selected codebase evidence
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Select a registered codebase as the architecture subject. The scan is bounded (depth, skipped vendor trees,
          symlink directories skipped) and captures evidence for the selected project, not the Electron tool.
        </p>
        {codebases.length > 0 ? (
          <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            <span className="muted">Architecture subject (registered codebase)</span>
            <select
              className="input"
              value={selectedCodebase?.id ?? ''}
              onChange={(e) => setSelectedCodebaseId(e.currentTarget.value)}
            >
              {codebases.map((c) => (
                <option key={c.id} value={c.id}>
                  {codebaseLabel(c)}
                  {c.disabled ? ' (disabled)' : ''}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            No registered codebases yet. Add one under Codebase landscape, or pick a workspace folder manually below.
          </p>
        )}
        <div className="arch-repo-scan-actions">
          <button type="button" className="btn-secondary" onClick={() => void props.onChooseScanRoot()}>
            Choose workspace folder
          </button>
          <button type="button" className="btn-secondary" onClick={() => void props.onClearScanRoot()} disabled={!props.scanRoot}>
            Clear scan root
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void runScan()}
            disabled={!effectiveScanRoot || scanBusy}
          >
            {scanBusy ? 'Scanning…' : 'Run workspace scan'}
          </button>
        </div>
        <p className="arch-repo-path muted" style={{ marginBottom: 0 }}>
          <strong>Current architecture subject:</strong>{' '}
          {selectedCodebase ? codebaseLabel(selectedCodebase) : <em>Not selected</em>}
        </p>
        <p className="arch-repo-path muted" style={{ marginTop: 4, marginBottom: 0 }}>
          <strong>Current scan root:</strong> {effectiveScanRoot ?? <em>Not set</em>}
        </p>
        {scanErr ? <div className="err-banner arch-repo-scan-err">{scanErr}</div> : null}
        {scanResult ? (
          <div className="arch-repo-scan-results">
            <p className="muted">
              Generated <code className="inline-code">{scanResult.generatedAt}</code>
              {scanResult.truncated ? ' · Scan truncated at safety limits.' : ''}
            </p>
            <table className="arch-repo-table">
              <tbody>
                <tr>
                  <th scope="row">Files counted</th>
                  <td>{scanResult.fileCount}</td>
                </tr>
                <tr>
                  <th scope="row">Directories counted</th>
                  <td>{scanResult.directoryCount}</td>
                </tr>
                <tr>
                  <th scope="row">Lines sampled (estimate)</th>
                  <td>{scanResult.linesSampled}</td>
                </tr>
                <tr>
                  <th scope="row">package.json name</th>
                  <td>{scanResult.manifestHints.packageName ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Gradle (Kotlin DSL)</th>
                  <td>{scanResult.manifestHints.hasGradleKotlin ? 'Present' : '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Gradle (Groovy)</th>
                  <td>{scanResult.manifestHints.hasGradleGroovy ? 'Present' : '—'}</td>
                </tr>
              </tbody>
            </table>
            {scanResult.integrationSurfaceDirs.length > 0 ? (
              <>
                <h4 className="arch-repo-subheading">Integration surfaces detected</h4>
                <ul className="arch-repo-list">
                  {scanResult.integrationSurfaceDirs.map((d) => (
                    <li key={d}>
                      <code className="inline-code">{d}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {scanResult.notableRelativePaths.length > 0 ? (
              <>
                <h4 className="arch-repo-subheading">Notable paths</h4>
                <ul className="arch-repo-list">
                  {scanResult.notableRelativePaths.map((d) => (
                    <li key={d}>
                      <code className="inline-code">{d}</code>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            <h4 className="arch-repo-subheading">File types (top extensions)</h4>
            {formatExtTable(scanResult.extensions)}
            <h4 className="arch-repo-subheading">Candidate application communication diagram (heuristic draft)</h4>
            <p className="muted">
              This diagram is a **candidate** view derived from common folder names; validate against your authoritative
              Application Architecture models.
            </p>
            {scanResult.candidateHeuristicMermaid ? (
              <MermaidDiagram source={scanResult.candidateHeuristicMermaid} />
            ) : (
              <p className="muted">No heuristic diagram available for this workspace layout.</p>
            )}
          </div>
        ) : null}
      </section>
    ) : null

  return (
    <div className="architecture-repository-view">
      <div className="arch-repo-shell">
        <aside className="arch-repo-nav" aria-label="TOGAF-aligned Architecture Repository">
          <p className="arch-repo-nav-title">Architecture Repository</p>
          <p className="arch-repo-nav-lead muted">
            ADM, ACF, Enterprise Continuum, and repository partitions (Software architect).
          </p>
          <nav className="arch-repo-nav-list" aria-label="TOGAF repository structure">
            {TOGAF_REPOSITORY_NAV_GROUPS.map((group) => {
              const expanded = chapterOpen[group.groupId] ?? false
              const panelId = `arch-repo-chapter-${group.groupId}`
              const headId = `arch-repo-chapter-head-${group.groupId}`
              return (
              <div key={group.groupId} className="arch-repo-nav-group">
                <button
                  type="button"
                  className="arch-repo-nav-group-toggle"
                  id={headId}
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  title={group.groupHint}
                  onClick={() => toggleChapter(group.groupId)}
                >
                  <i
                    className={`fa-solid arch-repo-nav-chevron ${expanded ? 'fa-chevron-down' : 'fa-chevron-right'}`}
                    aria-hidden
                  />
                  <span className="arch-repo-nav-group-title">{group.groupTitle}</span>
                  <span className="visually-hidden">{group.groupHint}</span>
                </button>
                <div
                  id={panelId}
                  className="arch-repo-nav-group-items"
                  role="group"
                  aria-labelledby={headId}
                  hidden={!expanded}
                >
                  {expanded
                    ? group.items.map((item) => {
                        const hasUnreadChange =
                          TOGAF_REPOSITORY_CHANGED_ARTIFACTS.includes(item.id) && !viewedChangeSet.has(item.id)
                        return (
                          <button
                            key={item.id}
                            type="button"
                            className={`arch-repo-nav-btn${selected === item.id ? ' arch-repo-nav-btn--active' : ''}`}
                            title={`${item.label} — ${item.admHint}`}
                            onClick={() => {
                              setChapterOpen((p) => ({ ...p, [group.groupId]: true }))
                              setSelected(item.id)
                            }}
                          >
                            <span className="arch-repo-nav-btn-label-row">
                              <span className="arch-repo-nav-btn-label">{item.label}</span>
                              {hasUnreadChange ? (
                                <>
                                  <span className="arch-repo-change-dot" aria-hidden />
                                  <span className="visually-hidden">Updated content not viewed yet</span>
                                </>
                              ) : null}
                            </span>
                            <span className="arch-repo-nav-btn-hint muted">{item.admHint}</span>
                          </button>
                        )
                      })
                    : null}
                </div>
              </div>
              )
            })}
          </nav>
        </aside>
        <div className="arch-repo-detail" ref={detailRef}>
          <section className="arch-repo-preamble panel-like" aria-label="TOGAF chapter preamble">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h3 className="settings-section-title" style={{ marginBottom: 0 }}>
                <i className="fa-solid fa-table" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
                Chapter preamble
              </h3>
              <button
                type="button"
                className="btn-secondary"
                aria-expanded={preambleOpen}
                onClick={() => setPreambleOpen((v) => !v)}
              >
                {preambleOpen ? 'Hide preamble' : 'Show preamble'}
              </button>
            </div>
            {preambleOpen ? (
              <>
                <table className="arch-repo-table" style={{ marginTop: 10 }}>
                  <tbody>
                    <tr>
                      <th scope="row">Chapter</th>
                      <td>{selectedNavMeta?.itemLabel ?? selected}</td>
                    </tr>
                    <tr>
                      <th scope="row">TOGAF structure area</th>
                      <td>{selectedNavMeta?.groupTitle ?? 'Repository'}</td>
                    </tr>
                    <tr>
                      <th scope="row">Intent</th>
                      <td>{selectedNavMeta?.admHint ?? 'TOGAF-aligned reference framing'}</td>
                    </tr>
                    <tr>
                      <th scope="row">Observed evidence focus</th>
                      <td>{preambleEvidenceFocus(selected)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Architecture subject</th>
                      <td>{selectedCodebase ? codebaseLabel(selectedCodebase) : 'Not selected (manual root fallback)'}</td>
                    </tr>
                  </tbody>
                </table>
                <hr className="arch-repo-preamble-rule" />
              </>
            ) : null}
          </section>
          {isDecisionRecordChapter(selected) ? (
            <DecisionRecordLayoutPanel
              chapterLabel={selectedNavMeta?.itemLabel ?? selected}
              chapterHint={selectedNavMeta?.admHint ?? 'Governance chapter'}
              chapterContent={chapterMarkdownToRender}
              onNavigateToDecision={navigateToDecision}
            />
          ) : null}
          {selected !== 'architecture_repository_overview' ? (
            <section className="arch-repo-generate panel-like" aria-label="Chapter generation">
              <h3 className="settings-section-title">
                <i className="fa-solid fa-wand-magic-sparkles" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
                Chapter generation (loaded model)
              </h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Analyze the selected repository context and generate a chapter draft for <strong>{selectedNavMeta?.itemLabel ?? selected}</strong>.
              </p>
              <p className="muted" style={{ marginTop: 0 }}>
                <strong>Source scope:</strong>{' '}
                {chapterRepoSpecific ? 'Repository-specific (single selected repository)' : 'All registered repositories'}
              </p>
              {chapterRepoSpecific && codebases.length > 0 ? (
                <label style={{ display: 'grid', gap: 6, marginBottom: 10 }}>
                  <span className="muted">Repository scope selector</span>
                  <select
                    className="input"
                    value={selectedCodebase?.id ?? ''}
                    onChange={(e) => setSelectedCodebaseId(e.currentTarget.value)}
                  >
                    {codebases.map((c) => (
                      <option key={c.id} value={c.id}>
                        {codebaseLabel(c)}
                        {c.disabled ? ' (disabled)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="arch-repo-scan-actions">
                <button type="button" className="btn-primary" onClick={() => void generateChapterDraft()} disabled={generateBusy}>
                  {generateBusy ? 'Generating chapter draft…' : 'Generate chapter draft'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void saveCurrentChapterAsVersion()}
                  disabled={generateBusy || saveVersionBusy}
                >
                  {saveVersionBusy ? 'Saving chapter version…' : 'Save chapter version'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={clearGeneratedDraft}
                  disabled={generateBusy || saveVersionBusy || !currentDraftHistory}
                >
                  Reset to baseline chapter
                </button>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                <strong>Sources:</strong>{' '}
                {chapterRepoSpecific
                  ? selectedCodebase
                    ? codebaseLabel(selectedCodebase)
                    : effectiveScanRoot ?? 'Not selected'
                  : `${codebases.filter((c) => !c.disabled).length || (effectiveScanRoot ? 1 : 0)} repositories`}
              </p>
              {currentDraftHistory ? (
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  <p className="muted" style={{ margin: 0 }}>
                    <strong>Draft versions:</strong> {currentDraftHistory.versions.length} (active: v{currentDraftHistory.activeVersion})
                  </p>
                  <div className="arch-repo-scan-actions" style={{ margin: 0 }}>
                    <select
                      className="input"
                      value={rollbackVersion === '' ? '' : String(rollbackVersion)}
                      onChange={(e) => {
                        const raw = e.currentTarget.value
                        setRollbackVersion(raw ? Number.parseInt(raw, 10) : '')
                      }}
                      style={{ minWidth: 220 }}
                    >
                      {currentDraftHistory.versions
                        .slice()
                        .sort((a, b) => b.version - a.version)
                        .map((v) => (
                          <option key={v.version} value={String(v.version)}>
                            {`v${v.version}${v.format ? ` [${v.format}]` : ''} - ${new Date(v.createdAt).toLocaleString()}${v.modelPath ? ` (${v.modelPath})` : ''}`}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        generateBusy ||
                        saveVersionBusy ||
                        rollbackVersion === '' ||
                        rollbackVersion === currentDraftHistory.activeVersion
                      }
                      onClick={() => {
                        if (rollbackVersion === '') return
                        void rollbackGeneratedDraft(rollbackVersion)
                          .then(() => setGenerateInfo(`Rolled back to draft v${rollbackVersion}`))
                          .catch((e) => setGenerateErr(e instanceof Error ? e.message : String(e)))
                      }}
                    >
                      Roll back to selected version
                    </button>
                  </div>
                </div>
              ) : null}
              {generateErr ? <div className="err-banner arch-repo-scan-err">{generateErr}</div> : null}
              {generateInfo ? <p className="muted" style={{ marginBottom: 0 }}>{generateInfo}</p> : null}
              {generateProgressPhase ? (
                <div className="panel-like" style={{ marginTop: 10, padding: 10 }}>
                  <div className="arch-repo-generation-progress-wrap">
                    <div className="arch-repo-generation-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={generateProgressPercent}>
                      <div
                        className={`arch-repo-generation-progress-fill${generateProgressPhase === 'Failed' ? ' arch-repo-generation-progress-fill--failed' : ''}`}
                        style={{ width: `${Math.max(0, Math.min(100, generateProgressPercent))}%` }}
                      />
                    </div>
                    <span className="muted">{generateProgressPercent}%</span>
                  </div>
                  <p className="muted" style={{ margin: 0 }}>
                    <strong>Generation progress:</strong> {generateProgressPhase}
                    {generateProgressTokens
                      ? ` · prompt ${generateProgressTokens.prompt ?? '—'} · completion ${generateProgressTokens.completion ?? '—'}`
                      : ''}
                  </p>
                  {generateProgressPreview &&
                  (generateProgressPhase === 'Finalizing output' ||
                    generateProgressPhase === 'Completed' ||
                    generateProgressPhase === 'Failed') ? (
                    <pre className="arch-repo-code-fence" style={{ marginTop: 8, marginBottom: 0 }}>
                      {generateProgressPreview}
                    </pre>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
          {selected === 'application_architecture_catalog' ? scanWorkspacePanel : null}
          {selected === 'architecture_repository_overview' ? (
            <>
              <RepositoryMarkdown markdown={chapterMarkdownToRender} formatHint={activeGeneratedDraft?.format ?? null} />
              <ArchRepositoryOverviewDiagram onNavigate={navigateToArtifact} />
            </>
          ) : (
            <RepositoryMarkdown markdown={chapterMarkdownToRender} formatHint={activeGeneratedDraft?.format ?? null} />
          )}
          {observedEvidencePanel ? <div style={{ marginTop: 16 }}>{observedEvidencePanel}</div> : null}
          <footer className="arch-repo-footer muted">
            TOGAF is a trademark of The Open Group. This view uses TOGAF-aligned terminology for a local architecture
            repository; it is not a certified ADM tool.
          </footer>
        </div>
      </div>
    </div>
  )
}
