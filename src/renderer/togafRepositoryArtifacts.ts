/** TOGAF-aligned artifact bodies (Markdown + optional ```mermaid fences). */

export type TogafRepositoryArtifactId =
  | 'architecture_repository_overview'
  | 'adm_preliminary_phase'
  | 'architecture_principles'
  | 'architecture_governance_log'
  | 'architecture_vision'
  | 'business_architecture_catalog'
  | 'application_architecture_catalog'
  | 'data_architecture_catalog'
  | 'technology_architecture_catalog'
  | 'adm_phase_e_opportunities_solutions'
  | 'adm_phase_f_migration_planning'
  | 'adm_phase_g_implementation_governance'
  | 'adm_phase_h_architecture_change_management'
  | 'architecture_requirements_catalog'
  | 'acf_deliverables_artifacts'
  | 'acf_catalogs_matrices'
  | 'enterprise_continuum'
  | 'repo_architecture_metamodel'
  | 'repo_architecture_capability'
  | 'repo_architecture_landscape'
  | 'standards_information_base'
  | 'reference_library'
  | 'building_blocks_abb_sbb'
  | 'architecture_repository_diagrams'

export type TogafRepositoryNavItem = {
  id: TogafRepositoryArtifactId
  label: string
  /** ADM, ACF, Enterprise Continuum, or Architecture Repository hint */
  admHint: string
}

export type TogafRepositoryNavGroup = {
  /** Stable key for React */
  groupId: string
  groupTitle: string
  groupHint: string
  items: TogafRepositoryNavItem[]
}

/** Navigation grouped by major TOGAF domains (ADM, ACF, Enterprise Continuum, Repository). */
export const TOGAF_REPOSITORY_NAV_GROUPS: TogafRepositoryNavGroup[] = [
  {
    groupId: 'repository_overview',
    groupTitle: 'Overview',
    groupHint: 'TOGAF Architecture Repository structure and entry points',
    items: [
      {
        id: 'architecture_repository_overview',
        label: 'Repository overview',
        admHint: 'Standard partitions — interactive map'
      }
    ]
  },
  {
    groupId: 'governance_preliminary',
    groupTitle: 'Governance & Preliminary',
    groupHint: 'Architecture Board, principles, capability, governance repository',
    items: [
      {
        id: 'adm_preliminary_phase',
        label: 'Preliminary Phase',
        admHint: 'ADM — establish architecture capability'
      },
      {
        id: 'architecture_principles',
        label: 'Architecture Principles catalog',
        admHint: 'Governance inputs; statement of intent'
      },
      {
        id: 'architecture_governance_log',
        label: 'Governance Repository',
        admHint: 'Decisions, compliance, dispensation (conceptual)'
      }
    ]
  },
  {
    groupId: 'adm_cycle',
    groupTitle: 'Architecture Development Method (ADM)',
    groupHint: 'Phases A–H and domain B/C/D catalogs',
    items: [
      { id: 'architecture_vision', label: 'Phase A — Architecture Vision', admHint: 'ADM Phase A' },
      { id: 'business_architecture_catalog', label: 'Phase B — Business Architecture', admHint: 'ADM Phase B' },
      {
        id: 'application_architecture_catalog',
        label: 'Phase C — Application Architecture',
        admHint: 'ADM Phase C (applications)'
      },
      { id: 'data_architecture_catalog', label: 'Phase C — Data Architecture', admHint: 'ADM Phase C (data)' },
      { id: 'technology_architecture_catalog', label: 'Phase D — Technology Architecture', admHint: 'ADM Phase D' },
      {
        id: 'adm_phase_e_opportunities_solutions',
        label: 'Phase E — Opportunities & Solutions',
        admHint: 'ADM Phase E'
      },
      {
        id: 'adm_phase_f_migration_planning',
        label: 'Phase F — Migration Planning',
        admHint: 'ADM Phase F'
      },
      {
        id: 'adm_phase_g_implementation_governance',
        label: 'Phase G — Implementation Governance',
        admHint: 'ADM Phase G'
      },
      {
        id: 'adm_phase_h_architecture_change_management',
        label: 'Phase H — Architecture Change Management',
        admHint: 'ADM Phase H'
      }
    ]
  },
  {
    groupId: 'requirements_acf',
    groupTitle: 'Requirements & Content Framework',
    groupHint: 'Continuous requirements; ACF deliverables',
    items: [
      {
        id: 'architecture_requirements_catalog',
        label: 'Requirements Management',
        admHint: 'Central process across all ADM phases'
      },
      {
        id: 'acf_deliverables_artifacts',
        label: 'ACF — Deliverables & artifacts',
        admHint: 'Architecture Content Framework'
      },
      {
        id: 'acf_catalogs_matrices',
        label: 'ACF — Catalogs & matrices',
        admHint: 'Cross-domain relationships'
      }
    ]
  },
  {
    groupId: 'enterprise_continuum',
    groupTitle: 'Enterprise Continuum',
    groupHint: 'Genericity: Foundation → Organization-specific',
    items: [
      {
        id: 'enterprise_continuum',
        label: 'Continuum & building blocks',
        admHint: 'Foundation, Common, Industry, Organization'
      },
      {
        id: 'building_blocks_abb_sbb',
        label: 'ABB & SBB',
        admHint: 'Architecture vs Solution Building Blocks'
      }
    ]
  },
  {
    groupId: 'architecture_repository',
    groupTitle: 'Architecture Repository (partitions)',
    groupHint: 'TOGAF repository structure; metamodel, landscape, standards',
    items: [
      {
        id: 'repo_architecture_metamodel',
        label: 'Architecture Metamodel',
        admHint: 'Classes of architectural things'
      },
      {
        id: 'repo_architecture_capability',
        label: 'Architecture Capability',
        admHint: 'Maturity, resources, skills'
      },
      {
        id: 'repo_architecture_landscape',
        label: 'Architecture Landscape',
        admHint: 'Inventory of building blocks'
      },
      {
        id: 'standards_information_base',
        label: 'Standards Information Base',
        admHint: 'Norms, standards, guidelines'
      },
      {
        id: 'reference_library',
        label: 'Reference Library',
        admHint: 'Patterns, models, external reference'
      }
    ]
  },
  {
    groupId: 'views_viewpoints',
    groupTitle: 'Views & viewpoints',
    groupHint: 'ISO 42010 / stakeholder concerns',
    items: [
      {
        id: 'architecture_repository_diagrams',
        label: 'Architecture views (diagrams)',
        admHint: 'Viewpoints in Mermaid'
      }
    ]
  }
]

/** Resolve sidebar chapter id for an artifact (expand target chapter when navigating). */
export function findGroupIdForArtifact(id: TogafRepositoryArtifactId): string | undefined {
  const g = TOGAF_REPOSITORY_NAV_GROUPS.find((gr) => gr.items.some((i) => i.id === id))
  return g?.groupId
}

export const TOGAF_REPOSITORY_DEFAULT_ARTIFACT: TogafRepositoryArtifactId =
  TOGAF_REPOSITORY_NAV_GROUPS[0].items[0].id

/**
 * Bump this when TOGAF chapter wording changes and users should see "new content" dots again.
 * The view persists seen chapters per version in local storage.
 */
export const TOGAF_REPOSITORY_CHANGESET_VERSION = '2026-04-loaded-codebases-reframe-v1'

/** Chapters updated in the current changelog scope. */
export const TOGAF_REPOSITORY_CHANGED_ARTIFACTS: readonly TogafRepositoryArtifactId[] = [
  'architecture_repository_overview',
  'adm_preliminary_phase',
  'architecture_vision',
  'business_architecture_catalog',
  'application_architecture_catalog',
  'data_architecture_catalog',
  'technology_architecture_catalog',
  'adm_phase_e_opportunities_solutions',
  'adm_phase_g_implementation_governance',
  'architecture_requirements_catalog',
  'acf_deliverables_artifacts',
  'acf_catalogs_matrices',
  'enterprise_continuum',
  'repo_architecture_metamodel',
  'repo_architecture_capability',
  'repo_architecture_landscape',
  'standards_information_base',
  'reference_library',
  'building_blocks_abb_sbb'
]

const REPOSITORY_OVERVIEW = `## Architecture Repository overview

The TOGAF **Architecture Repository** holds the outputs of architecture work and the material that governs and describes it. The standard partitions the repository into the major areas shown in the interactive diagram below — select a partition to open the corresponding catalog in this view.

| Partition | TOGAF role |
| --- | --- |
| **Architecture Metamodel** | Defines the types of architectural things you describe and how they relate. |
| **Architecture Capability** | Describes how the organization performs architecture (process maturity, skills, tools). |
| **Architecture Landscape** | Inventory of building blocks at appropriate levels of detail (strategic through operational). |
| **Standards Information Base** | Normative standards, regulations, and organizational policies. |
| **Reference Library** | Non-normative reference material, patterns, and external models. |
| **Governance Repository** | Decisions, compliance records, and dispensation history. |

Use the diagram to jump to a partition. **ADM**, **ACF**, and **Enterprise Continuum** entry points are shown as related domains below the core repository map.

The prose above is **TOGAF reference framing** only. **Observed architecture evidence** from the loaded/selected codebases (counts, scans, run signals, settings) appears in the chapter-specific panel below when you select a catalog. The Electron desktop app is the repository workbench, not the architecture subject.
`

const PRELIMINARY = `## Preliminary Phase

The **Preliminary Phase** establishes the organizational expectation that enterprise architecture will be developed and governed: architecture capability, Architecture Board (or equivalent), scope of the architecture engagement, and interfaces to program and portfolio management.

| Concern | Architecture Repository entry (conceptual) |
| --- | --- |
| Sponsorship & mandate | Architecture Vision linkage; governance log |
| Tailored ADM | Which ADM phases are in scope for this engagement |
| Architecture principles | Architecture Principles catalog (this chapter) |
| Tools & organization | Skills, repositories, collaboration with solution delivery |

Record tailoring decisions and capability baselines in your engagement’s system of record; align this repository’s **observed codebase evidence** with that record where applicable.
`

const GOVERNANCE_LOG = `## Governance Repository

The **Governance Repository** holds material that shows **how** architecture is governed: decision records, compliance assessments, waivers, and audit outcomes.

| Artifact (conceptual) | Typical content |
| --- | --- |
| Architecture Decision Record (ADR) | Decision, context, consequences |
| Compliance assessment | Mapping architecture to standards |
| Dispensation | Time-bound non-compliance with rationale |

Use your organization’s workflow (e.g. ticketing or document management) as the system of record; this chapter documents the **TOGAF placement** of those artifacts alongside technical catalogs.
`

const PRINCIPLES = `## Architecture Principles catalog

Principles are **normative statements** that guide trade-offs across ADM phases. Typical patterns:

| Principle class | Example statement | Architecture effect |
| --- | --- | --- |
| Integrity | “Authoritative data has a single source of truth” | Shapes Data and Application catalogs |
| Reuse | “Prefer composable services over duplication” | Shapes Application and Technology standards |
| Security / privacy | “Least privilege and data minimization” | Shapes Technology and Governance evidence |

Author your organization’s principles in controlled documentation; use this chapter for **catalog structure** and the **observed evidence** panel for session-captured checks where available.

TOGAF is a trademark of The Open Group.
`

const VISION = `## Phase A — Architecture Vision

Phase **A** agrees **why** architecture is needed, for **whom**, and what **success** looks like. Typical Vision deliverables include:

| Work product | Content |
| --- | --- |
| Stakeholder map | Power / interest and concerns |
| Business goals & drivers | Measurable objectives and constraints |
| Scope statement | In / out of scope for the architecture effort |
| Solution concept | Candidate high-level shape (not detailed design) |

Capture Vision material in your engagement’s documents or ingested notes; this view does not substitute a Vision document — it only holds **TOGAF structure** and **observed evidence** attached to selected projects/codebases.
`

const BUSINESS = `## Phase B — Business Architecture catalog

Business Architecture describes **what the enterprise does** independently of systems: capabilities, value streams, organization, information concepts at a business level.

| Catalog element | Typical content |
| --- | --- |
| Business capability | Stable “what we do” building blocks |
| Value stream | End-to-end delivery paths and hand-offs |
| Business information | Canonical business terms and relationships |

**Observed evidence** for this chapter is drawn from **knowledge-base topics you have accumulated** (as a proxy for business-information artifacts in the loaded project landscape), not from the tool’s own design.
`

const APPLICATION_STATIC = `## Phase C — Application Architecture catalog

Application Architecture catalogs **logical applications**, their interfaces, and how they collaborate to deliver business outcomes.

| Catalog element | Typical content |
| --- | --- |
| Application | Named application service or system |
| Interface | APIs, events, batch exchanges |
| Application communication | Who talks to whom, and on what protocols |

### Observed application evidence (selected codebase)

Use **Codebase landscape** registration and **Run workspace scan** below to collect **bounded** filesystem evidence from the codebase you are assessing (vendor trees such as \`node_modules\` are skipped). Results are **observations about the selected architecture subject**, not a description of the tool hosting this repository.
`

const DATA_STATIC = `## Phase C — Data Architecture catalog

Data Architecture catalogs **business and application data**: entities, relationships, lifecycle, and quality rules.

| Catalog element | Typical content |
| --- | --- |
| Data entity | Canonical thing of interest |
| Logical data model | Relationships and cardinalities |
| Data lifecycle | Create, read, retain, archive, delete policies |

### Observed data evidence (loaded project context)

When you load or refresh the **knowledge graph** for ingested material, structural counts and truncation flags appear in the **Observed evidence** panel for this chapter. Those metrics describe **captured project knowledge**, not the workbench application's internal storage design.
`

const TECH_STATIC = `## Phase D — Technology Architecture catalog

Technology Architecture catalogs **platforms, hardware, communications, and standards** that realize the Application and Data architectures.

| Catalog element | Typical content |
| --- | --- |
| Technology component | Servers, runtimes, databases, networks |
| Technology standard | Approved versions, patching posture |
| Deployment / hosting | Where workloads run and how they fail over |

### Observed technology evidence (selected architecture subject)

The **Observed evidence** panel for this chapter shows **integration endpoints and paths you have configured**, **models directory selection**, and an optional **workstation hardware sample** when one has been collected during your session — all as **assessment observations** about the selected subject context, not as a product datasheet.
`

const PHASE_E = `## Phase E — Opportunities & Solutions

Phase **E** identifies delivery groupings (work packages, transition architectures, solution outlines) that satisfy the **Architecture Vision** and the gap between Baseline and Target architectures.

| Work product (conceptual) | Purpose |
| --- | --- |
| Solution architecture outline | Candidate grouping of change |
| Dependencies & constraints | Cross-portfolio coordination |
| Value/risk sketch | Prioritization input for migration |

Treat **recorded training or transformation jobs**, **runtime choices**, and **integration enablement** you observe while assessing a codebase as **candidate solution components** to be reconciled with your wider roadmap and decision logs.
`

const PHASE_F = `## Phase F — Migration Planning

Phase **F** produces a **Migration Architecture** and a synchronized roadmap: what moves when, enablers, and interdependencies.

| Planning element | Notes |
| --- | --- |
| Transition states | Baseline → intermediate → target |
| Work packages | Sequenced deliverables |
| Business value checkpoints | Governance milestones |

Link migration steps to **Technology** and **Application** catalogs so traceability is preserved.
`

const PHASE_G = `## Phase G — Implementation Governance

Phase **G** ensures that implementation projects conform to the target architecture: scope drift management, architecture contracts, and compliance checkpoints.

| Governance hook | Example |
| --- | --- |
| Architecture Contract | Between project and architecture function |
| Compliance reviews | Against Technology and Application standards |
| Change request | When implementation diverges from approved architecture |

Use your SDLC tooling as the system of record; this repository workbench surfaces **observed implementation signals** (for example integration activity and formal run outcomes) as adjunct evidence only.
`

const PHASE_H = `## Phase H — Architecture Change Management

Phase **H** establishes a process for managing **change to the architectures** themselves: new business drivers, technology refresh, or lessons learned.

| Trigger | Typical response |
| --- | --- |
| New stakeholder concern | Re-open relevant ADM phases |
| Obsolescence | Update Technology Architecture catalog |
| Incident / debt | Update Requirements and Governance log |

Architecture Change Management closes the loop back to **Preliminary** and **Vision** when strategy shifts materially.
`

const REQUIREMENTS = `## Requirements Management (continuous)

Requirements Management runs **throughout** the ADM: capture, baseline, trace, and dispose of requirements across business, information systems, and technology domains.

| Activity | Notes |
| --- | --- |
| Baseline | Agree authoritative requirement statements |
| Allocate | Map requirements to ADM phases and building blocks |
| Trace | Link requirements to catalog entries, tests, and releases |

**Observed requirement signals** in this repository are **examples only** (for example integration, verification, and hardware observations captured in-session). Authoritative requirements belong in your requirements tool.
`

const ACF_DELIVERABLES = `## Architecture Content Framework — Deliverables & artifacts

TOGAF distinguishes **deliverables** (reviewable outputs), **artifacts** (descriptions of architecture from a viewpoint), and **building blocks** (reusable components).

| Kind | Role |
| --- | --- |
| Deliverable | Contracted output of a process step (e.g. Architecture Vision document) |
| Artifact | Catalog entry, matrix, diagram, or model fragment |
| Building Block | Reusable specification (ABB) or implementation (SBB) |

Use your document control system for formal **deliverables**; use this repository workbench for **artifact-shaped evidence** you choose to capture (text, scans, metrics) under the TOGAF categories above.
`

const ACF_CATALOGS = `## Architecture Content Framework — Catalogs & matrices

**Catalogs** list building blocks by type (e.g. application, data entity, technology standard). **Matrices** show relationships (e.g. application–data, application–technology).

| Matrix (example) | Shows |
| --- | --- |
| Application–Data | Which applications create/use which data entities |
| Application–Technology | Which standards each application relies on |
| Role–Concern | Stakeholder mapping to views |

**Observed evidence** for matrices in this repository is limited to **cross-cutting counts** (for example topics vs. graph size and run history) that you can treat as seeds for fuller matrices in your EA tools.
`

const CONTINUUM = `## Enterprise Continuum

The **Enterprise Continuum** classifies reusability from generic to organization-specific:

| Level | Content |
| --- | --- |
| Foundation | Universal building blocks, reference models |
| Common Systems | Shared enterprise-wide solutions |
| Industry | Sector-specific elements |
| Organization | Your specific architectures and solutions |

\`\`\`mermaid
flowchart LR
  F[Foundation_Architectures]
  C[Common_Systems_Architectures]
  I[Industry_Architectures]
  O[Organization_Architectures]
  F --> C --> I --> O
\`\`\`

Classify **your own** solution assets along the continuum (from generic reference patterns through organization-specific deployments). **Observed evidence** here uses **top-level folder names** from selected-codebase scans as a coarse hint only.
`

const ABB_SBB = `## Architecture Building Blocks and Solution Building Blocks

| Term | Meaning |
| --- | --- |
| **ABB** | A *specification* of capability (logical, technology-neutral where possible) |
| **SBB** | A *realization* — specific products, APIs, or deployments that implement ABBs |

| Example (generic) | ABB perspective | SBB perspective |
| --- | --- | --- |
| Customer record | “Customer master” logical service | Vendor CRM module + API version |
| Payment | “Payment capture” capability | PSP connector deployment |

Maintain traceability **ABB → SBB** when you record implementation choices. **Observed file-type mixes** from codebase scans can hint at concrete SBBs on disk for the selected codebase.
`

const METAMODEL = `## Architecture Metamodel

The **Architecture Metamodel** defines the types of things you describe (classes, relationships, attributes) — the grammar of your architecture descriptions.

| Metamodel area | Examples |
| --- | --- |
| Motivation | Drivers, goals, objectives |
| Business | Capabilities, processes, roles |
| Information Systems | Applications, data entities, interfaces |
| Technology | Platforms, hardware, communications |

Define and govern your **enterprise metamodel** in your central EA repository; this workbench does not replace that authority.
`

const CAPABILITY = `## Architecture Capability

**Architecture Capability** describes *how well* the organization practices architecture: governance, skills, methods, tools, and collaboration.

| Dimension | Typical evidence |
| --- | --- |
| Method | ADM tailoring, templates, checkpoints |
| People | Roles, skills, communities of practice |
| Tools | Authoring, modeling, repository automation |
| Collaboration | Review boards, workshops, async commentary |

Assess maturity in your organization’s **capability assessments**; this workbench only stores **usage-derived signals** where you have configured integrations or similar probes.
`

const LANDSCAPE = `## Architecture Landscape

The **Architecture Landscape** inventories building blocks at **Strategic**, **Segment**, **Capability**, or **Operational** levels (depth of detail increases toward implementation).

| Level | Typical inventory |
| --- | --- |
| Strategic | Major systems and directions |
| Segment | Portfolio or product-line view |
| Capability | Services supporting value streams |
| Operational | Deployed instances and versions |

A **bounded filesystem scan** of selected repositories can contribute **operational / segment** inventory hints; it is not a full strategic landscape. **Observed evidence** for Landscape uses the latest scan results you generated for the selected architecture subject.
`

const STANDARDS_BASE = `## Standards Information Base

The **Standards Information Base** holds **normative** guidance: organizational standards, vendor constraints, legal/regulatory rules, and industry codes.

| Class | Examples |
| --- | --- |
| Mandatory | Security baselines, privacy rules |
| Advisory | Preferred stacks, coding standards |
| Retired | Superseded norms with end dates |

Map **approved norms** and **exceptions** into your Standards Information Base in your system of record. **Observed evidence** here is limited to **high-level control settings** you have enabled in this workbench (for example integration listen state and whether an access token is configured).
`

const REFERENCE_LIB = `## Reference Library

The **Reference Library** contains **non-normative** material: reference architectures, vendor whitepapers, patterns, and external models used as input to architecture work.

| Item | Use |
| --- | --- |
| Pattern catalog | Proven interaction models |
| External reference models | e.g. industry capability maps |
| Vendor or product documentation | Integration surfaces and constraints |

Ingest or link **reference** material (whitepapers, patterns, external models) through your normal knowledge pipeline; **observed topic counts** reflect what you have loaded for assessed projects, not workbench documentation.
`

const DIAGRAMS = `## Architecture views (diagrams)

**Views** address stakeholder **concerns**; **viewpoints** define the conventions for a class of views (notation, metamodel slice). Mermaid diagrams here are **architecture views** under agreed viewpoints (structural, behavioral, deployment).

### TOGAF repository areas (navigation metaphor)

\`\`\`mermaid
flowchart TB
  subgraph ADM["ADM cycle"]
    A[Phase_A_Vision]
    B[Phase_B_Business]
    C1[Phase_C_Applications]
    C2[Phase_C_Data]
    D[Phase_D_Technology]
    E[Phase_E_Opportunities]
    F[Phase_F_Migration]
    G[Phase_G_Impl_governance]
    H[Phase_H_Change]
  end
  subgraph ACF["Architecture Content Framework"]
    Del[Deliverables_and_artifacts]
    CM[Catalogs_and_matrices]
  end
  subgraph EC["Enterprise Continuum"]
    L1[Foundation]
    L2[Common]
    L3[Industry]
    L4[Organization]
  end
  subgraph ARP["Architecture Repository"]
    MM[Metamodel]
    Cap[Capability]
    Land[Landscape]
    SIB[Standards_base]
    RL[Reference_library]
    GR[Governance_repo]
  end
  A --> B --> C1 --> C2 --> D --> E --> F --> G --> H
  Del --> CM
  L1 --> L2 --> L3 --> L4
  MM --> Cap
  Cap --> Land
  SIB --- RL
  GR -.->|governs| A
\`\`\`
`

export const TOGAF_REPOSITORY_MARKDOWN: Record<TogafRepositoryArtifactId, string> = {
  architecture_repository_overview: REPOSITORY_OVERVIEW,
  adm_preliminary_phase: PRELIMINARY,
  architecture_principles: PRINCIPLES,
  architecture_governance_log: GOVERNANCE_LOG,
  architecture_vision: VISION,
  business_architecture_catalog: BUSINESS,
  application_architecture_catalog: APPLICATION_STATIC,
  data_architecture_catalog: DATA_STATIC,
  technology_architecture_catalog: TECH_STATIC,
  adm_phase_e_opportunities_solutions: PHASE_E,
  adm_phase_f_migration_planning: PHASE_F,
  adm_phase_g_implementation_governance: PHASE_G,
  adm_phase_h_architecture_change_management: PHASE_H,
  architecture_requirements_catalog: REQUIREMENTS,
  acf_deliverables_artifacts: ACF_DELIVERABLES,
  acf_catalogs_matrices: ACF_CATALOGS,
  enterprise_continuum: CONTINUUM,
  repo_architecture_metamodel: METAMODEL,
  repo_architecture_capability: CAPABILITY,
  repo_architecture_landscape: LANDSCAPE,
  standards_information_base: STANDARDS_BASE,
  reference_library: REFERENCE_LIB,
  building_blocks_abb_sbb: ABB_SBB,
  architecture_repository_diagrams: DIAGRAMS
}
