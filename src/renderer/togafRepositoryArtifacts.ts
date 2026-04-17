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
`

const PRELIMINARY = `## Preliminary Phase

The **Preliminary Phase** establishes the organizational expectation that enterprise architecture will be developed and governed: architecture capability, Architecture Board (or equivalent), scope of the architecture engagement, and interfaces to program and portfolio management.

| Concern | Architecture Repository entry (conceptual) |
| --- | --- |
| Sponsorship & mandate | Architecture Vision linkage; governance log |
| Tailored ADM | Which ADM phases are in scope for this engagement |
| Architecture principles | Architecture Principles catalog (this repository) |
| Tools & organization | Skills, repositories, collaboration with solution delivery |

This desktop repository is a **local** workspace for evidence and views; align it with your enterprise-wide Architecture Repository where applicable.
`

const GOVERNANCE_LOG = `## Governance Repository

The **Governance Repository** holds material that shows **how** architecture is governed: decision records, compliance assessments, waivers, and audit outcomes.

| Artifact (conceptual) | Typical content |
| --- | --- |
| Architecture Decision Record (ADR) | Decision, context, consequences |
| Compliance assessment | Mapping architecture to standards |
| Dispensation | Time-bound non-compliance with rationale |

Use your organization’s workflow (e.g. ticketing or document management) as the system of record; this view documents the **TOGAF placement** of those artifacts alongside technical catalogs.
`

const PRINCIPLES = `## Architecture Principles catalog

| Principle ID | Statement | Implication for this workspace |
| --- | --- | --- |
| AP-01 | **Separation of concerns** | Main process, preload bridge, and renderer remain distinct application architecture elements. |
| AP-02 | **Defense in depth** | Localhost integration, optional token, and user-controlled model paths reduce accidental exposure. |
| AP-03 | **Evidence-based description** | Application and data catalogs in this repository prefer measurable inputs (scan summaries, knowledge graph counts). |

These statements follow the *Architecture Principles* concept in the TOGAF Architecture Content Framework (conceptual alignment; TOGAF is a trademark of The Open Group).
`

const VISION = `## Phase A — Architecture Vision

**Problem statement:** Teams need a private, workstation-local loop for large language models, knowledge capture, and optional IDE-assisted workflows.

**Objective:** Provide a desktop shell that orchestrates model runtimes, a knowledge wiki, training exports, and a bounded integration surface for tools such as IntelliJ.

**Stakeholder map (summary):**

| Stakeholder | Concern |
| --- | --- |
| Software architect | Traceable architecture descriptions, catalogs, and candidate views |
| Software developer | Bridge, packaging, and developer hub diagnostics |
| Tester / QA | Observable metrics and integration health |

## Solution Concept diagram (high level)

\`\`\`mermaid
flowchart LR
  subgraph VisionScope["Architecture Vision — scope"]
    U[User_workstation]
    D[Desktop_shell]
    M[Model_runtime]
    K[Knowledge_store]
  end
  U --> D
  D --> M
  D --> K
\`\`\`
`

const BUSINESS = `## Phase B — Business Architecture catalog

| Business object | Definition | Notes |
| --- | --- | --- |
| Chat session | A durable conversation between the user and the assistant | Stored locally; optional extraction to the knowledge base |
| Knowledge article | A compiled wiki page from ingested sources | Supports findability and traceability for decisions |
| Training job | A bounded fine-tuning run from exported knowledge or JSONL | Produces artifacts consumable by the model runtime |

Extend with **Business Capability** maps, value streams, and organization/decomposition models as your repository matures.
`

const APPLICATION_STATIC = `## Phase C — Application Architecture catalog

Use **Choose workspace folder** and **Run workspace scan** to populate *Application Architecture* evidence for a repository on disk (bounded scan; \`node_modules\` and similar trees are skipped).

### Default logical application architecture (this product)

\`\`\`mermaid
flowchart TB
  subgraph Apps["Application Architecture — logical"]
    R[Renderer_process]
    P[Preload_context_isolation]
    M[Main_process]
  end
  R <-->|contextBridge| P
  P -->|IPC_invoke| M
\`\`\`

### Integration application

| Application / service | Protocol | Notes |
| --- | --- | --- |
| IDE bridge | HTTP on loopback | Configured port and optional token in Settings → Integrations |
| Model runtime | llama.cpp HTTP or Ollama API | Selected in Run drawer |
`

const DATA_STATIC = `## Phase C — Data Architecture catalog

### Logical data entities (in-app)

| Entity | Persistence | Architecture note |
| --- | --- | --- |
| Conversations and messages | SQLite (application data) | Chat retention policy is user-controlled |
| Knowledge chunks and FTS | SQLite + vectors path | Supports RAG and wiki compilation |
| Wiki graph | Derived structure over sources | Refreshed when the knowledge graph is loaded |

### Data relationships (conceptual)

\`\`\`mermaid
flowchart LR
  subgraph DataArch["Data Architecture — knowledge"]
    S[Source]
    C[Chunk]
    W[Wiki_page]
  end
  S -->|contains| C
  C -->|compiled_into| W
\`\`\`

Dynamic counts appear in **Live architecture data** when the knowledge graph has been loaded.
`

const TECH_STATIC = `## Phase D — Technology Architecture catalog

### Technology standards (illustrative)

| Standard / product | Category | Usage in architecture |
| --- | --- | --- |
| Electron | Application platform | Desktop packaging and process model |
| better-sqlite3 | Embedded RDBMS | Structured application and knowledge data |
| llama.cpp / Ollama | Model serving | Technology components for inference |

### Technology deployment (conceptual)

\`\`\`mermaid
flowchart TB
  subgraph Tech["Technology Architecture — workstation"]
    Desk[Desktop_OS]
    App[Electron_application]
    Llm[Model_runtime]
    Plugin[IDE_plugin_optional]
  end
  Desk --> App
  App --> Llm
  Plugin -->|loopback_HTTP| App
\`\`\`

Hardware and disk summaries appear under **Live architecture data** when available.
`

const PHASE_E = `## Phase E — Opportunities & Solutions

Phase **E** identifies delivery groupings (work packages, transition architectures, solution outlines) that satisfy the **Architecture Vision** and the gap between Baseline and Target architectures.

| Work product (conceptual) | Purpose |
| --- | --- |
| Solution architecture outline | Candidate grouping of change |
| Dependencies & constraints | Cross-portfolio coordination |
| Value/risk sketch | Prioritization input for migration |

For this application, treat training jobs, model runtime choices, and integration enablement as **candidate solution components** to be recorded against your wider roadmap.
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

Use your SDLC tooling as the system of record; this repository holds the **architectural intent** and evidence summaries.
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

| Requirement ID | Type | Statement | Verification |
| --- | --- | --- | --- |
| ARQ-SEC-01 | Security architecture | Integration server listens on loopback only; token optional | Inspect integration settings |
| ARQ-PRIV-01 | Privacy | Primary inference and chat data remain on the workstation | Observe local-only stores |
| ARQ-OBS-01 | Service quality | Metrics widgets expose runtime health signals | Pin Stats and review snapshots |

Maintain traceability from requirements to **catalog entries** and **diagrams** in this repository.
`

const ACF_DELIVERABLES = `## Architecture Content Framework — Deliverables & artifacts

TOGAF distinguishes **deliverables** (reviewable outputs), **artifacts** (descriptions of architecture from a viewpoint), and **building blocks** (reusable components).

| Kind | Role |
| --- | --- |
| Deliverable | Contracted output of a process step (e.g. Architecture Vision document) |
| Artifact | Catalog entry, matrix, diagram, or model fragment |
| Building Block | Reusable specification (ABB) or implementation (SBB) |

This repository surfaces **artifacts** (catalogs, matrices, diagrams) aligned to ADM phases; formal **deliverables** remain in your document control system.
`

const ACF_CATALOGS = `## Architecture Content Framework — Catalogs & matrices

**Catalogs** list building blocks by type (e.g. application, data entity, technology standard). **Matrices** show relationships (e.g. application–data, application–technology).

| Matrix (example) | Shows |
| --- | --- |
| Application–Data | Which applications create/use which data entities |
| Application–Technology | Which standards each application relies on |
| Role–Concern | Stakeholder mapping to views |

The **Live architecture data** panel provides a thin, machine-derived slice of catalog values for this running instance.
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

Place this desktop product in **Organization** architectures; reuse patterns from **Foundation** and **Industry** where you adopt open models or IDE ecosystems.
`

const ABB_SBB = `## Architecture Building Blocks and Solution Building Blocks

| Term | Meaning |
| --- | --- |
| **ABB** | A *specification* of capability (logical, technology-neutral where possible) |
| **SBB** | A *realization* — specific products, APIs, or deployments that implement ABBs |

| Example (this product) | ABB perspective | SBB perspective |
| --- | --- | --- |
| Model access | “Inference service” component | Ollama tag or llama.cpp binary path |
| Knowledge | “Managed knowledge store” | SQLite + vectors layout on disk |

Maintain traceability **ABB → SBB** when you record implementation choices.
`

const METAMODEL = `## Architecture Metamodel

The **Architecture Metamodel** defines the types of things you describe (classes, relationships, attributes) — the grammar of your architecture descriptions.

| Metamodel area | Examples |
| --- | --- |
| Motivation | Drivers, goals, objectives |
| Business | Capabilities, processes, roles |
| Information Systems | Applications, data entities, interfaces |
| Technology | Platforms, hardware, communications |

This UI uses a fixed metamodel subset oriented to desktop, knowledge, and integration concerns; extend in your central EA tool for full enterprise coverage.
`

const CAPABILITY = `## Architecture Capability

**Architecture Capability** describes *how well* the organization practices architecture: governance, skills, methods, tools, and collaboration.

| Dimension | Repository hook |
| --- | --- |
| Method | ADM tailoring recorded in Preliminary |
| People | Role-based surfaces (e.g. Software architect) |
| Tools | This Architecture Repository view |
| Collaboration | IDE bridge, wiki, chat exports |

Assess maturity separately; this view is one **tooling** enabler under capability.
`

const LANDSCAPE = `## Architecture Landscape

The **Architecture Landscape** inventories building blocks at **Strategic**, **Segment**, **Capability**, or **Operational** levels (depth of detail increases toward implementation).

| Level | Typical inventory |
| --- | --- |
| Strategic | Major systems and directions |
| Segment | Portfolio or product-line view |
| Capability | Services supporting value streams |
| Operational | Deployed instances and versions |

The workspace **scan** contributes an **operational / segment** hint for a chosen codebase; it is not a full strategic landscape.
`

const STANDARDS_BASE = `## Standards Information Base

The **Standards Information Base** holds **normative** guidance: organizational standards, vendor constraints, legal/regulatory rules, and industry codes.

| Class | Examples |
| --- | --- |
| Mandatory | Security baselines, privacy rules |
| Advisory | Preferred stacks, coding standards |
| Retired | Superseded norms with end dates |

Map runtime choices (Electron version, TLS assumptions for local HTTP, data retention) into this base as your organization requires.
`

const REFERENCE_LIB = `## Reference Library

The **Reference Library** contains **non-normative** material: reference architectures, vendor whitepapers, patterns, and external models used as input to architecture work.

| Item | Use |
| --- | --- |
| Pattern catalog | Proven interaction models |
| External reference models | e.g. industry capability maps |
| Product documentation | For integration surfaces |

Your arc42 or other documentation sets may be cross-linked here as **reference** (distinct from **standards**).
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
