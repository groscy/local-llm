# Architecture Repository Scope (TOGAF-aligned)

This documentation track defines the architecture repository viewpoint used by the Software architect surfaces in the app.

## Scope

- **Primary architecture subjects:** loaded/registered project codebases.
- **Repository workbench/tooling:** the Electron desktop app in this repository.
- **Out of scope for this track:** detailed internal design of the Electron app itself (kept in the parallel arc42 set).

## How codebases map to TOGAF repository partitions

| TOGAF partition | Codebase-centered evidence in this workspace |
| --- | --- |
| Architecture Landscape | Bounded scan of selected codebase roots, top-level inventory hints, notable paths |
| Application Architecture | Heuristic communication candidates, integration surfaces, manifest hints |
| Data Architecture | Knowledge-graph structure for ingested project material |
| Technology Architecture | Runtime/integration settings and workstation context used during assessment |
| Governance Repository | IDE bridge activity and formal run outcomes retained in-session |
| Reference Library | Ingested notes/documents linked to assessed projects |

## Governance boundary (authoritative vs observed)

- **Authoritative system of record (outside this app):** enterprise architecture repository, requirements tools, governance records, portfolio roadmaps.
- **Observed evidence in this app:** bounded scans, analysis snapshots, run logs, and session-derived metrics that support architecture work.
- **Expected usage:** use this app to capture and inspect evidence, then publish approved deliverables to authoritative repositories.

## Relationship to tool architecture docs

For architecture documentation of the Electron workbench itself, use the arc42 set:

- [`docs/architecture-arc42/README.md`](../architecture-arc42/README.md)

