import type { ReactElement } from 'react'
import type { ArchitectureRepositoryScanResult } from '@shared/architectureRepository'
import type { HardwareSummary, WikiTopic } from '@shared/types'
import { WIKI_KIND_LABELS, WIKI_KIND_ORDER, wikiKindCounts } from '@shared/wikiSourceGroups'
import { formatBytes } from './downloadProgressUi'
import type { TogafRepositoryArtifactId } from './togafRepositoryArtifacts'

export type ArchitectureEvidenceProps = {
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
  scanRoot: string | null
  scanResult: ArchitectureRepositoryScanResult | null
  trainJobCount: number
  pluginReportCount: number
}

function EvidenceShell(props: {
  chapterTitle: string
  lead?: string
  children: ReactElement
}): ReactElement {
  return (
    <section className="arch-repo-live panel-like" aria-label={props.chapterTitle}>
      <h3 className="settings-section-title">
        <i className="fa-solid fa-database" aria-hidden style={{ marginRight: 8, opacity: 0.75 }} />
        {props.chapterTitle}
      </h3>
      {props.lead ? (
        <p className="muted" style={{ marginTop: 0 }}>
          {props.lead}
        </p>
      ) : null}
      {props.children}
    </section>
  )
}

/**
 * TOGAF-aligned **observed** architecture inputs: data gathered while using the workspace,
 * shown only for the chapter that can consume it (no cross-chapter dump).
 */
export function renderObservedArchitectureEvidence(
  artifact: TogafRepositoryArtifactId,
  p: ArchitectureEvidenceProps
): ReactElement | null {
  const wikiByKind = wikiKindCounts(p.wikiTopics)
  const wikiTotal = p.wikiTopics.length

  const techIntegrationTable = (
    <table className="arch-repo-table">
      <tbody>
        <tr>
          <th scope="row">Observed integration listen state</th>
          <td>{p.integrationListenEnabled ? 'Enabled' : 'Disabled'}</td>
        </tr>
        <tr>
          <th scope="row">Observed integration port</th>
          <td>
            <code className="inline-code">{p.integrationPort}</code>
          </td>
        </tr>
        <tr>
          <th scope="row">Observed models / weights directory</th>
          <td className="arch-repo-path-cell">{p.modelsDefaultPath ?? '—'}</td>
        </tr>
      </tbody>
    </table>
  )

  const techHardwareBlock =
    !p.hardwareSummary ? (
      <p className="muted" style={{ marginBottom: 0 }}>
        No workstation hardware sample captured yet in this session. Open Run or Stats elsewhere in the workspace to
        populate this observation.
      </p>
    ) : (
      <table className="arch-repo-table">
        <tbody>
          <tr>
            <th scope="row">Logical processors (observed)</th>
            <td>{p.hardwareSummary.logicalCores}</td>
          </tr>
          <tr>
            <th scope="row">Total RAM (observed)</th>
            <td>{formatBytes(p.hardwareSummary.totalRamBytes)}</td>
          </tr>
          <tr>
            <th scope="row">Free RAM (observed)</th>
            <td>{formatBytes(p.hardwareSummary.freeRamBytes)}</td>
          </tr>
          <tr>
            <th scope="row">Free space on models volume (observed)</th>
            <td>
              {p.hardwareSummary.downloadVolumeFreeBytes != null
                ? formatBytes(p.hardwareSummary.downloadVolumeFreeBytes)
                : '—'}
            </td>
          </tr>
        </tbody>
      </table>
    )

  const dataKgBlock = p.kgLoading ? (
    <p className="muted">Loading knowledge graph observations…</p>
  ) : (
    <>
      <table className="arch-repo-table">
        <tbody>
          <tr>
            <th scope="row">Knowledge graph nodes (observed)</th>
            <td>{p.kgNodeCount}</td>
          </tr>
          <tr>
            <th scope="row">Knowledge graph edges (observed)</th>
            <td>{p.kgEdgeCount}</td>
          </tr>
          <tr>
            <th scope="row">Graph payload truncated</th>
            <td>{p.kgTruncated ? 'Yes' : 'No'}</td>
          </tr>
        </tbody>
      </table>
      <button type="button" className="btn-secondary arch-repo-refresh-kg" onClick={() => p.onRefreshKnowledgeGraph()}>
        Refresh knowledge graph
      </button>
    </>
  )

  switch (artifact) {
    case 'architecture_repository_overview': {
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — cross-domain snapshot"
          lead="Single-session observations gathered from this workspace (not a description of the tool itself)."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">Business catalog entries (wiki topics observed)</th>
                <td>{wikiTotal}</td>
              </tr>
              <tr>
                <th scope="row">Data graph nodes / edges (observed)</th>
                <td>
                  {p.kgLoading ? '…' : `${p.kgNodeCount} / ${p.kgEdgeCount}`}
                </td>
              </tr>
              <tr>
                <th scope="row">Workspace scan root configured</th>
                <td>{p.scanRoot ? 'Yes' : 'No'}</td>
              </tr>
              <tr>
                <th scope="row">Training jobs recorded</th>
                <td>{p.trainJobCount}</td>
              </tr>
              <tr>
                <th scope="row">IDE bridge reports retained</th>
                <td>{p.pluginReportCount}</td>
              </tr>
              <tr>
                <th scope="row">Integration listen (observed)</th>
                <td>{p.integrationListenEnabled ? 'On' : 'Off'}</td>
              </tr>
              <tr>
                <th scope="row">Hardware sample available</th>
                <td>{p.hardwareSummary ? 'Yes' : 'No'}</td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )
    }

    case 'adm_preliminary_phase':
    case 'architecture_principles':
    case 'architecture_vision':
      return (
        <EvidenceShell
          chapterTitle={`Observed evidence — ${artifact === 'adm_preliminary_phase' ? 'Preliminary Phase' : artifact === 'architecture_principles' ? 'Architecture Principles' : 'Architecture Vision'}`}
          lead="Motivation and framing artifacts are usually captured outside this view. No automated session observations are mapped here yet."
        >
          <p className="muted" style={{ margin: 0 }}>
            When you record drivers, goals, or vision statements in your knowledge base, treat those sources as the
            evidence trail for this chapter.
          </p>
        </EvidenceShell>
      )

    case 'architecture_governance_log':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Governance Repository"
          lead="Signals from integration activity retained in this session (not a full governance system of record)."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">IDE bridge reports retained</th>
                <td>{p.pluginReportCount}</td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )

    case 'business_architecture_catalog':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Business Architecture catalog"
          lead="Counts of knowledge-base topics you have accumulated (proxy for business-information artifacts in this workspace)."
        >
          {wikiTotal === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No wiki topics observed yet.</p>
          ) : (
            <table className="arch-repo-table">
              <thead>
                <tr>
                  <th scope="col">Topic kind (observed)</th>
                  <th scope="col">Count</th>
                </tr>
              </thead>
              <tbody>
                {WIKI_KIND_ORDER.map((k) => (
                  <tr key={k}>
                    <td>{WIKI_KIND_LABELS[k]}</td>
                    <td>{wikiByKind[k]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </EvidenceShell>
      )

    case 'data_architecture_catalog':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Data Architecture catalog"
          lead="Structural observations from the compiled knowledge graph in this workspace."
        >
          {dataKgBlock}
        </EvidenceShell>
      )

    case 'technology_architecture_catalog':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Technology Architecture catalog"
          lead="Runtime and workstation observations captured during this session."
        >
          <div className="arch-repo-live-grid">
            <div>
              <h4 className="arch-repo-subheading">Integration &amp; deployment context</h4>
              {techIntegrationTable}
            </div>
            <div>
              <h4 className="arch-repo-subheading">Workstation sample</h4>
              {techHardwareBlock}
            </div>
          </div>
        </EvidenceShell>
      )

    case 'standards_information_base':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Standards Information Base"
          lead="Normative controls you have configured in this workspace (observed settings, not policy text)."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">Integration listen</th>
                <td>{p.integrationListenEnabled ? 'Enabled' : 'Disabled'}</td>
              </tr>
              <tr>
                <th scope="row">Integration port</th>
                <td>
                  <code className="inline-code">{p.integrationPort}</code>
                </td>
              </tr>
              <tr>
                <th scope="row">Integration token configured</th>
                <td>{p.integrationTokenConfigured ? 'Yes' : 'No'}</td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )

    case 'reference_library':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Reference Library"
          lead="Non-normative material you have ingested into the knowledge base (titles observed in-session)."
        >
          <p className="muted" style={{ marginTop: 0 }}>
            <strong>Wiki topics observed:</strong> {wikiTotal}
            {wikiTotal > 0
              ? ` — open the Business Architecture chapter for a breakdown by topic kind.`
              : '.'}
          </p>
        </EvidenceShell>
      )

    case 'repo_architecture_landscape':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Architecture Landscape"
          lead="Inventory hints from the last workspace scan (configure and run the scan from Phase C — Application Architecture)."
        >
          {!p.scanResult ? (
            <p className="muted" style={{ margin: 0 }}>
              No scan results in memory. Run a bounded workspace scan under Application Architecture to populate landscape
              observations.
            </p>
          ) : (
            <table className="arch-repo-table">
              <tbody>
                <tr>
                  <th scope="row">Scan root (observed)</th>
                  <td className="arch-repo-path-cell">{p.scanResult.root}</td>
                </tr>
                <tr>
                  <th scope="row">Files / directories counted</th>
                  <td>
                    {p.scanResult.fileCount} / {p.scanResult.directoryCount}
                    {p.scanResult.truncated ? ' (truncated)' : ''}
                  </td>
                </tr>
                <tr>
                  <th scope="row">Top-level names (sample)</th>
                  <td className="arch-repo-path-cell">
                    {p.scanResult.topLevelNames.slice(0, 12).join(', ') || '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </EvidenceShell>
      )

    case 'building_blocks_abb_sbb':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Building blocks (file mix)"
          lead="Extension histogram from the last workspace scan proxies concrete building-block instances on disk."
        >
          {!p.scanResult ? (
            <p className="muted" style={{ margin: 0 }}>Run a workspace scan under Application Architecture first.</p>
          ) : (
            <table className="arch-repo-table">
              <thead>
                <tr>
                  <th scope="col">Extension</th>
                  <th scope="col">Files</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(p.scanResult.extensions)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 12)
                  .map(([ext, n]) => (
                    <tr key={ext}>
                      <td>
                        <code className="inline-code">{ext}</code>
                      </td>
                      <td>{n}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </EvidenceShell>
      )

    case 'enterprise_continuum':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Enterprise Continuum"
          lead="Top-level folders from the configured workspace scan suggest where material sits on the genericity spectrum (heuristic)."
        >
          {!p.scanResult?.topLevelNames.length ? (
            <p className="muted" style={{ margin: 0 }}>
              No scan data. Configure a workspace root and scan from Application Architecture.
            </p>
          ) : (
            <ul className="arch-repo-list" style={{ marginBottom: 0 }}>
              {p.scanResult.topLevelNames.slice(0, 24).map((name) => (
                <li key={name}>
                  <code className="inline-code">{name}</code>
                </li>
              ))}
            </ul>
          )}
        </EvidenceShell>
      )

    case 'acf_catalogs_matrices':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Catalogs &amp; matrices (session slice)"
          lead="Cross-cutting counts you can use as matrix seeds (sources ↔ graph)."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">Wiki topics</th>
                <td>{wikiTotal}</td>
              </tr>
              <tr>
                <th scope="row">Knowledge graph nodes / edges</th>
                <td>
                  {p.kgLoading ? '…' : `${p.kgNodeCount} / ${p.kgEdgeCount}`}
                </td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )

    case 'acf_deliverables_artifacts':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Deliverables &amp; artifacts"
          lead="Quantitative footprint of ingested material and graph complexity in this workspace."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">Wiki topics (artifact proxies)</th>
                <td>{wikiTotal}</td>
              </tr>
              <tr>
                <th scope="row">Graph edges (relationship proxies)</th>
                <td>{p.kgLoading ? '…' : p.kgEdgeCount}</td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )

    case 'architecture_requirements_catalog': {
      const rows: { id: string; type: string; statement: string; verification: string }[] = []
      rows.push({
        id: 'OBS-INT-01',
        type: 'Observed control',
        statement: `Integration listen is ${p.integrationListenEnabled ? 'enabled' : 'disabled'} on port ${p.integrationPort}.`,
        verification: 'Captured from current workspace settings'
      })
      rows.push({
        id: 'OBS-INT-02',
        type: 'Observed control',
        statement: `Integration token ${p.integrationTokenConfigured ? 'is' : 'is not'} configured.`,
        verification: 'Captured from current workspace settings'
      })
      if (p.hardwareSummary) {
        rows.push({
          id: 'OBS-HW-01',
          type: 'Observed NFR',
          statement: `Workstation reports ${p.hardwareSummary.logicalCores} logical CPUs and ${formatBytes(p.hardwareSummary.totalRamBytes)} RAM.`,
          verification: 'Captured hardware summary in this session'
        })
      }
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Architecture Requirements catalog"
          lead="Machine-captured requirement signals from this session (examples only; extend in your authoritative requirements tool)."
        >
          <table className="arch-repo-table">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Type</th>
                <th scope="col">Statement (observed)</th>
                <th scope="col">Verification</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <code className="inline-code">{r.id}</code>
                  </td>
                  <td>{r.type}</td>
                  <td>{r.statement}</td>
                  <td>{r.verification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </EvidenceShell>
      )
    }

    case 'adm_phase_e_opportunities_solutions':
    case 'adm_phase_f_migration_planning':
      return (
        <EvidenceShell
          chapterTitle={`Observed evidence — ${artifact === 'adm_phase_e_opportunities_solutions' ? 'Phase E' : 'Phase F'}`}
          lead="Fine-tuning and migration-style work recorded in this workspace (job registry)."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">Training jobs recorded</th>
                <td>{p.trainJobCount}</td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )

    case 'adm_phase_g_implementation_governance':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Phase G (implementation signals)"
          lead="Activity retained from IDE integration sessions (proxy for implementation touchpoints)."
        >
          <table className="arch-repo-table">
            <tbody>
              <tr>
                <th scope="row">IDE bridge reports retained</th>
                <td>{p.pluginReportCount}</td>
              </tr>
            </tbody>
          </table>
        </EvidenceShell>
      )

    case 'adm_phase_h_architecture_change_management':
      return (
        <EvidenceShell
          chapterTitle="Observed evidence — Phase H"
          lead="Architecture change events are not automatically mined in this view."
        >
          <p className="muted" style={{ margin: 0 }}>
            Track change tickets or post-incident reviews in your governance tool; link summaries into the knowledge base
            if you want them to appear as Business or Governance evidence.
          </p>
        </EvidenceShell>
      )

    case 'repo_architecture_metamodel':
    case 'repo_architecture_capability':
      return (
        <EvidenceShell
          chapterTitle={`Observed evidence — ${artifact === 'repo_architecture_metamodel' ? 'Architecture Metamodel' : 'Architecture Capability'}`}
          lead="No dedicated automated probes for this partition yet."
        >
          <p className="muted" style={{ margin: 0 }}>
            Use narrative artifacts in your knowledge base, or export assessments from your EA repository, and ingest them
            for traceability.
          </p>
        </EvidenceShell>
      )

    case 'architecture_repository_diagrams':
      return null

    default:
      return null
  }
}
