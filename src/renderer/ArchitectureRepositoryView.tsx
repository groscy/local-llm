import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { useCallback, useMemo, useState, type ReactElement } from 'react'
import type { ArchitectureRepositoryScanResult } from '@shared/architectureRepository'
import type { HardwareSummary } from '@shared/types'
import { formatBytes } from './downloadProgressUi'
import { MermaidDiagram } from './MermaidDiagram'
import { ArchRepositoryOverviewDiagram } from './ArchRepositoryOverviewDiagram'
import {
  TOGAF_REPOSITORY_MARKDOWN,
  TOGAF_REPOSITORY_NAV_GROUPS,
  TOGAF_REPOSITORY_DEFAULT_ARTIFACT,
  findGroupIdForArtifact,
  type TogafRepositoryArtifactId
} from './togafRepositoryArtifacts'

marked.use({ gfm: true, breaks: false })

function initialChapterOpenState(): Record<string, boolean> {
  const sel = TOGAF_REPOSITORY_DEFAULT_ARTIFACT
  const o: Record<string, boolean> = {}
  for (const g of TOGAF_REPOSITORY_NAV_GROUPS) {
    o[g.groupId] = g.items.some((i) => i.id === sel)
  }
  return o
}

type MdSegment = { kind: 'html'; html: string } | { kind: 'mermaid'; code: string; key: string }

function splitMarkdownMermaid(markdown: string): MdSegment[] {
  const segments: MdSegment[] = []
  const re = /```mermaid\s*\n([\s\S]*?)```/gi
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

function RepositoryMarkdown(props: { markdown: string; className?: string }): ReactElement {
  const parts = useMemo(() => splitMarkdownMermaid(props.markdown), [props.markdown])
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
  wikiTopicCount: number
  kgNodeCount: number
  kgEdgeCount: number
  kgLoading: boolean
  kgTruncated: boolean
  onRefreshKnowledgeGraph: () => void
  hardwareSummary: HardwareSummary | null
  modelsDefaultPath: string | null
}

export function ArchitectureRepositoryView(props: ArchitectureRepositoryViewProps): ReactElement {
  const [selected, setSelected] = useState<TogafRepositoryArtifactId>(TOGAF_REPOSITORY_DEFAULT_ARTIFACT)
  const [chapterOpen, setChapterOpen] = useState<Record<string, boolean>>(initialChapterOpenState)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanErr, setScanErr] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<ArchitectureRepositoryScanResult | null>(null)

  const runScan = useCallback(async () => {
    setScanBusy(true)
    setScanErr(null)
    try {
      const r = await window.api.architectureRepositoryScan()
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
  }, [])

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

  const liveBlock = (
    <section className="arch-repo-live panel-like">
      <h3 className="settings-section-title">
        <i className="fa-solid fa-wave-square" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
        Live architecture data
      </h3>
      <p className="muted" style={{ marginTop: 0 }}>
        These inputs are drawn from the running application state and your knowledge base, expressed using Architecture
        Repository catalog language.
      </p>
      <div className="arch-repo-live-grid">
        <div>
          <h4 className="arch-repo-subheading">Technology Architecture — integration</h4>
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">Integration listen</th>
                <td>{props.integrationListenEnabled ? 'Enabled' : 'Disabled'}</td>
              </tr>
              <tr>
                <th scope="row">Integration port</th>
                <td>
                  <code className="inline-code">{props.integrationPort}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">Models directory (default)</th>
                <td className="arch-repo-path-cell">{props.modelsDefaultPath ?? '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="arch-repo-subheading">Data Architecture — knowledge graph</h4>
          {props.kgLoading ? (
            <p className="muted">Loading knowledge graph…</p>
          ) : (
            <table className="arch-repo-table">
              <tbody>
                <tr>
                  <th scope="row">Wiki topics (count)</th>
                  <td>{props.wikiTopicCount}</td>
                </tr>
                <tr>
                  <th scope="row">Graph nodes</th>
                  <td>{props.kgNodeCount}</td>
                </tr>
                <tr>
                  <th scope="row">Graph edges</th>
                  <td>{props.kgEdgeCount}</td>
                </tr>
                <tr>
                  <th scope="row">Graph payload truncated</th>
                  <td>{props.kgTruncated ? 'Yes' : 'No'}</td>
                </tr>
              </tbody>
            </table>
          )}
          <button type="button" className="btn-secondary arch-repo-refresh-kg" onClick={() => props.onRefreshKnowledgeGraph()}>
            Refresh knowledge graph
          </button>
        </div>
        <div>
          <h4 className="arch-repo-subheading">Technology Architecture — workstation</h4>
          {!props.hardwareSummary ? (
            <p className="muted">Hardware summary not loaded yet (open Run or Stats once to populate).</p>
          ) : (
            <table className="arch-repo-table">
              <tbody>
                <tr>
                  <th scope="row">Logical CPUs</th>
                  <td>{props.hardwareSummary.logicalCores}</td>
                </tr>
                <tr>
                  <th scope="row">Total RAM</th>
                  <td>{formatBytes(props.hardwareSummary.totalRamBytes)}</td>
                </tr>
                <tr>
                  <th scope="row">Free RAM</th>
                  <td>{formatBytes(props.hardwareSummary.freeRamBytes)}</td>
                </tr>
                <tr>
                  <th scope="row">Download volume free</th>
                  <td>
                    {props.hardwareSummary.downloadVolumeFreeBytes != null
                      ? formatBytes(props.hardwareSummary.downloadVolumeFreeBytes)
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </section>
  )

  const scanWorkspacePanel =
    selected === 'application_architecture_catalog' ? (
      <section className="arch-repo-scan panel-like">
        <h3 className="settings-section-title">
          <i className="fa-solid fa-folder-tree" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
          Application Architecture — workspace evidence
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Select a codebase root. The scan is bounded (depth, skipped vendor trees, symlink directories skipped) and
          intended as **architecture evidence**, not a full static-analysis workbench.
        </p>
        <div className="arch-repo-scan-actions">
          <button type="button" className="btn-secondary" onClick={() => void props.onChooseScanRoot()}>
            Choose workspace folder
          </button>
          <button type="button" className="btn-secondary" onClick={() => void props.onClearScanRoot()} disabled={!props.scanRoot}>
            Clear scan root
          </button>
          <button type="button" className="btn-primary" onClick={() => void runScan()} disabled={!props.scanRoot || scanBusy}>
            {scanBusy ? 'Scanning…' : 'Run workspace scan'}
          </button>
        </div>
        <p className="arch-repo-path muted" style={{ marginBottom: 0 }}>
          <strong>Current scan root:</strong> {props.scanRoot ?? <em>Not set</em>}
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
        {liveBlock}
      </section>
    ) : null

  /** Application catalog embeds live data inside the scan panel; overview focuses on the map; other pages show live data below markdown. */
  const liveBelowMarkdown =
    selected !== 'application_architecture_catalog' && selected !== 'architecture_repository_overview'

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
                    ? group.items.map((item) => (
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
                          <span className="arch-repo-nav-btn-label">{item.label}</span>
                          <span className="arch-repo-nav-btn-hint muted">{item.admHint}</span>
                        </button>
                      ))
                    : null}
                </div>
              </div>
              )
            })}
          </nav>
        </aside>
        <div className="arch-repo-detail">
          {selected === 'architecture_repository_overview' ? (
            <>
              <RepositoryMarkdown markdown={TOGAF_REPOSITORY_MARKDOWN.architecture_repository_overview} />
              <ArchRepositoryOverviewDiagram onNavigate={navigateToArtifact} />
            </>
          ) : (
            <RepositoryMarkdown markdown={TOGAF_REPOSITORY_MARKDOWN[selected]} />
          )}
          {scanWorkspacePanel}
          {liveBelowMarkdown ? <div style={{ marginTop: 16 }}>{liveBlock}</div> : null}
          <footer className="arch-repo-footer muted">
            TOGAF is a trademark of The Open Group. This view uses TOGAF-aligned terminology for a local architecture
            repository; it is not a certified ADM tool.
          </footer>
        </div>
      </div>
    </div>
  )
}
