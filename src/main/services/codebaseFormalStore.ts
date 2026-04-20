import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { randomUUID } from 'crypto'
import type Store from 'electron-store'
import {
  CODEBASE_FORMAL_STORE_KEY,
  codebaseRootsEqual,
  MAX_FORMAL_VERIFICATION_RUNS,
  parseCodebaseFormalBundle,
  trimFormalRuns,
  upsertCodebaseByPath,
  type CodebaseFormalBundle,
  type CodebaseRecord,
  type FormalToolProfile,
  type FormalVerificationRun
} from '@shared/codebaseRegistry'
import type { PluginIntegrationReport } from '@shared/types'

export function readCodebaseFormalBundle(store: Store<Record<string, unknown>>): CodebaseFormalBundle {
  const raw = store.get(CODEBASE_FORMAL_STORE_KEY)
  return trimFormalRuns(parseCodebaseFormalBundle(raw), MAX_FORMAL_VERIFICATION_RUNS)
}

export function writeCodebaseFormalBundle(store: Store<Record<string, unknown>>, bundle: CodebaseFormalBundle): void {
  const trimmed = trimFormalRuns(bundle, MAX_FORMAL_VERIFICATION_RUNS)
  store.set(CODEBASE_FORMAL_STORE_KEY, trimmed)
}

function resolveExistingDir(rootPath: string): string | null {
  const abs = resolve(rootPath.trim())
  try {
    if (!existsSync(abs)) return null
    if (!statSync(abs).isDirectory()) return null
    return abs
  } catch {
    return null
  }
}

function metaString(meta: Record<string, string | number | boolean | null> | undefined, key: string): string | null {
  if (!meta) return null
  const v = meta[key]
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s.length > 0 ? s : null
}

/**
 * When the IntelliJ plugin sends `projectBasePath`, register or refresh that codebase.
 */
export function upsertCodebaseFromPluginReport(
  store: Store<Record<string, unknown>>,
  report: PluginIntegrationReport
): void {
  const base = metaString(report.meta, 'projectBasePath')
  if (!base) return
  const abs = resolveExistingDir(base)
  if (!abs) return
  const projectName = metaString(report.meta, 'project') ?? undefined
  const now = Date.now()
  let bundle = readCodebaseFormalBundle(store)
  bundle = upsertCodebaseByPath(bundle, abs, {
    origin: 'intellij_detected',
    linkedIdeProjectName: projectName,
    now,
    newRecordId: randomUUID()
  })
  writeCodebaseFormalBundle(store, bundle)
}

export function addManualCodebase(store: Store<Record<string, unknown>>, rootPath: string, displayName?: string): CodebaseRecord | null {
  const abs = resolveExistingDir(rootPath)
  if (!abs) return null
  const now = Date.now()
  let bundle = readCodebaseFormalBundle(store)
  bundle = upsertCodebaseByPath(bundle, abs, {
    origin: 'manual',
    now,
    newRecordId: randomUUID()
  })
  const idx = bundle.codebases.findIndex((c) => codebaseRootsEqual(c.rootPath, abs))
  if (idx < 0) return null
  const cur = bundle.codebases[idx]
  const next: CodebaseRecord = {
    ...cur,
    origin: 'manual',
    displayName: displayName?.trim() || cur.displayName,
    lastSeenAt: now
  }
  const codebases = [...bundle.codebases]
  codebases[idx] = next
  bundle = { ...bundle, codebases }
  writeCodebaseFormalBundle(store, bundle)
  return next
}

export function updateCodebase(
  store: Store<Record<string, unknown>>,
  id: string,
  patch: { displayName?: string; disabled?: boolean }
): CodebaseRecord | null {
  const bundle = readCodebaseFormalBundle(store)
  const idx = bundle.codebases.findIndex((c) => c.id === id)
  if (idx < 0) return null
  const cur = bundle.codebases[idx]
  const next: CodebaseRecord = {
    ...cur,
    displayName: patch.displayName !== undefined ? patch.displayName || undefined : cur.displayName,
    disabled: typeof patch.disabled === 'boolean' ? patch.disabled : cur.disabled
  }
  const codebases = [...bundle.codebases]
  codebases[idx] = next
  writeCodebaseFormalBundle(store, { ...bundle, codebases })
  return next
}

export function removeCodebase(store: Store<Record<string, unknown>>, id: string): boolean {
  const bundle = readCodebaseFormalBundle(store)
  const nextList = bundle.codebases.filter((c) => c.id !== id)
  if (nextList.length === bundle.codebases.length) return false
  writeCodebaseFormalBundle(store, {
    ...bundle,
    codebases: nextList,
    formalVerificationRuns: bundle.formalVerificationRuns.filter((r) => r.codebaseId !== id)
  })
  return true
}

export function addFormalProfile(store: Store<Record<string, unknown>>, profile: FormalToolProfile): void {
  const bundle = readCodebaseFormalBundle(store)
  writeCodebaseFormalBundle(store, {
    ...bundle,
    formalToolProfiles: [...bundle.formalToolProfiles.filter((p) => p.id !== profile.id), profile]
  })
}

export function updateFormalProfile(
  store: Store<Record<string, unknown>>,
  id: string,
  patch: { interpretWithLlm: 'inherit' | 'on' | 'off' }
): FormalToolProfile | null {
  const bundle = readCodebaseFormalBundle(store)
  const idx = bundle.formalToolProfiles.findIndex((p) => p.id === id)
  if (idx < 0) return null
  const cur = bundle.formalToolProfiles[idx]
  const next: FormalToolProfile = { ...cur }
  if (patch.interpretWithLlm === 'inherit') {
    delete next.interpretWithLlm
  } else {
    next.interpretWithLlm = patch.interpretWithLlm === 'on'
  }
  const formalToolProfiles = [...bundle.formalToolProfiles]
  formalToolProfiles[idx] = next
  writeCodebaseFormalBundle(store, { ...bundle, formalToolProfiles })
  return next
}

export function removeFormalProfile(store: Store<Record<string, unknown>>, id: string): boolean {
  const bundle = readCodebaseFormalBundle(store)
  const next = bundle.formalToolProfiles.filter((p) => p.id !== id)
  if (next.length === bundle.formalToolProfiles.length) return false
  writeCodebaseFormalBundle(store, { ...bundle, formalToolProfiles: next })
  return true
}

export function appendFormalRun(store: Store<Record<string, unknown>>, run: FormalVerificationRun): void {
  const bundle = readCodebaseFormalBundle(store)
  writeCodebaseFormalBundle(store, {
    ...bundle,
    formalVerificationRuns: [...bundle.formalVerificationRuns, run]
  })
}

export function updateFormalRun(store: Store<Record<string, unknown>>, run: FormalVerificationRun): void {
  const bundle = readCodebaseFormalBundle(store)
  const runs = bundle.formalVerificationRuns.map((r) => (r.id === run.id ? run : r))
  writeCodebaseFormalBundle(store, { ...bundle, formalVerificationRuns: runs })
}
