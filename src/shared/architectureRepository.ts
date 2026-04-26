/** Types for TOGAF-aligned Architecture Repository workspace scan (main + renderer). */

export type ArchitectureRepositoryScanResult = {
  root: string
  generatedAt: string
  truncated: boolean
  fileCount: number
  directoryCount: number
  /** Rough line count sampled from text-like source files (bounded). */
  linesSampled: number
  extensions: Record<string, number>
  topLevelNames: string[]
  integrationSurfaceDirs: string[]
  manifestHints: {
    hasPackageJson: boolean
    packageName?: string
    hasGradleKotlin: boolean
    hasGradleGroovy: boolean
  }
  notableRelativePaths: string[]
  /** Candidate Application Communication diagram (heuristic; draft only). */
  candidateHeuristicMermaid?: string
}

export type ArchitectureRepositoryScanResponse =
  | { ok: true; result: ArchitectureRepositoryScanResult }
  | { ok: false; error: string }

export type ArchitectureRepositoryScanRequest = {
  /** Optional explicit root path; when omitted, main falls back to persisted config root. */
  rootPath?: string
}
