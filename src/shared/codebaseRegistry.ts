/** Persisted codebase catalog + user-defined formal tool profiles + verification run history. */

export type CodebaseOrigin = 'manual' | 'intellij_detected'

export interface CodebaseRecord {
  id: string
  /** Normalized absolute path (platform separators as stored by main). */
  rootPath: string
  displayName?: string
  origin: CodebaseOrigin
  createdAt: number
  lastSeenAt: number
  linkedIdeProjectName?: string
  disabled: boolean
}

export type FormalSpawnMode = 'shell' | 'exec'

export interface FormalToolProfile {
  id: string
  label: string
  /**
   * Command line after substituting `{{root}}` with the codebase root (quoted when needed).
   * Stored profiles are user-authored; only this placeholder is expanded by the app.
   */
  commandTemplate: string
  spawnMode: FormalSpawnMode
  timeoutMs: number
  /** Exit codes treated as tool success (default [0]). */
  expectedExitCodes: number[]
  /**
   * When true, always run local-LLM interpretation after a verification run completes.
   * When false, never interpret for this profile. When omitted, use global `formalVerificationInterpretWithLlm`.
   */
  interpretWithLlm?: boolean
}

/** Non-proof natural-language summary attached to a verification run (advisory only). */
export interface FormalVerificationRunLlmAdvisory {
  text: string
  createdAt: number
  /** SHA-256 hex of bounded prompt inputs (for reproducibility notes). */
  promptHash: string
  disclaimer: string
}

export const FORMAL_LLM_ADVISORY_DISCLAIMER =
  'This text is a non-authoritative natural-language summary. The external tool exit code and logs are the verification verdict.'

export type FormalVerificationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timeout'

export interface FormalVerificationRun {
  id: string
  codebaseId: string
  profileId: string
  startedAt: number
  finishedAt?: number
  status: FormalVerificationRunStatus
  exitCode: number | null
  stdout: string
  stderr: string
  /** Fully expanded command as executed (after `{{root}}` substitution). */
  commandResolved: string
  /** Local model summary of evidence; does not replace tool verdict. */
  llmAdvisory?: FormalVerificationRunLlmAdvisory
  /** When interpretation was requested but chat failed or runtime was unavailable. */
  llmAdvisoryError?: string
}

export interface CodebaseFormalBundle {
  codebases: CodebaseRecord[]
  formalToolProfiles: FormalToolProfile[]
  formalVerificationRuns: FormalVerificationRun[]
}

export const CODEBASE_FORMAL_STORE_KEY = 'codebaseFormal'

export const MAX_FORMAL_VERIFICATION_RUNS = 120

export const MAX_FORMAL_RUN_STREAM_BYTES = 400_000

export const DEFAULT_FORMAL_TOOL_TIMEOUT_MS = 300_000

export function emptyCodebaseFormalBundle(): CodebaseFormalBundle {
  return {
    codebases: [],
    formalToolProfiles: [],
    formalVerificationRuns: []
  }
}

export function normalizeCodebaseRootPath(rootPath: string): string {
  const t = rootPath.trim()
  if (!t) return ''
  return t.replace(/\\/g, '/')
}

/** Compare two roots for deduplication (case-insensitive on Windows). */
export function codebaseRootsEqual(a: string, b: string): boolean {
  const na = normalizeCodebaseRootPath(a).toLowerCase()
  const nb = normalizeCodebaseRootPath(b).toLowerCase()
  return na === nb
}

export function parseCodebaseFormalBundle(raw: unknown): CodebaseFormalBundle {
  if (!raw || typeof raw !== 'object') return emptyCodebaseFormalBundle()
  const o = raw as Record<string, unknown>
  const codebases = Array.isArray(o.codebases) ? o.codebases : []
  const formalToolProfiles = Array.isArray(o.formalToolProfiles) ? o.formalToolProfiles : []
  const formalVerificationRuns = Array.isArray(o.formalVerificationRuns) ? o.formalVerificationRuns : []
  return {
    codebases: codebases.filter(isRecord) as unknown as CodebaseRecord[],
    formalToolProfiles: formalToolProfiles.filter(isRecord) as unknown as FormalToolProfile[],
    formalVerificationRuns: formalVerificationRuns.filter(isRecord) as unknown as FormalVerificationRun[]
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null
}

export type FormalVerificationProgressPhase = 'started' | 'stdout' | 'stderr' | 'finished'

export interface FormalVerificationProgressPayload {
  runId: string
  phase: FormalVerificationProgressPhase
  chunk?: string
  run?: FormalVerificationRun
}

export function trimFormalRuns(bundle: CodebaseFormalBundle, maxRuns: number): CodebaseFormalBundle {
  if (bundle.formalVerificationRuns.length <= maxRuns) return bundle
  const sorted = [...bundle.formalVerificationRuns].sort((a, b) => a.startedAt - b.startedAt)
  const drop = sorted.length - maxRuns
  return {
    ...bundle,
    formalVerificationRuns: sorted.slice(drop)
  }
}

/**
 * Insert or update a codebase by normalized root. Prefer keeping manual origin if already manual.
 */
export function upsertCodebaseByPath(
  bundle: CodebaseFormalBundle,
  rootPath: string,
  patch: {
    origin: CodebaseOrigin
    linkedIdeProjectName?: string
    now: number
    /** Required when inserting a new row; stable id from main (`randomUUID`). */
    newRecordId?: string
  }
): CodebaseFormalBundle {
  const norm = normalizeCodebaseRootPath(rootPath)
  if (!norm) return bundle
  const idx = bundle.codebases.findIndex((c) => codebaseRootsEqual(c.rootPath, norm))
  if (idx < 0) {
    const id = patch.newRecordId?.trim()
    if (!id) return bundle
    const rec: CodebaseRecord = {
      id,
      rootPath: norm,
      displayName: patch.linkedIdeProjectName,
      origin: patch.origin,
      createdAt: patch.now,
      lastSeenAt: patch.now,
      linkedIdeProjectName: patch.linkedIdeProjectName,
      disabled: false
    }
    return { ...bundle, codebases: [...bundle.codebases, rec] }
  }
  const cur = bundle.codebases[idx]
  const nextOrigin: CodebaseOrigin =
    cur.origin === 'manual' && patch.origin === 'intellij_detected' ? 'manual' : patch.origin
  const updated: CodebaseRecord = {
    ...cur,
    rootPath: norm,
    lastSeenAt: patch.now,
    origin: nextOrigin,
    linkedIdeProjectName: patch.linkedIdeProjectName ?? cur.linkedIdeProjectName,
    displayName: cur.displayName ?? patch.linkedIdeProjectName
  }
  const codebases = [...bundle.codebases]
  codebases[idx] = updated
  return { ...bundle, codebases }
}
