import { randomUUID } from 'crypto'
import { existsSync, statSync } from 'fs'
import { resolve } from 'path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type Store from 'electron-store'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { CodebaseWikiAnalysisProgress } from '@shared/types'
import {
  DEFAULT_FORMAL_TOOL_TIMEOUT_MS,
  type FormalToolProfile,
  type FormalVerificationProgressPayload,
  type FormalVerificationRun
} from '@shared/codebaseRegistry'
import {
  addFormalProfile,
  addManualCodebase,
  appendFormalRun,
  readCodebaseFormalBundle,
  removeCodebase,
  removeFormalProfile,
  updateCodebase,
  updateFormalProfile,
  updateFormalRun
} from '../services/codebaseFormalStore'
import {
  addCodebaseFromGitUrl,
  listLatestCodebaseAnalysisSnapshots,
  runCodebaseWikiAnalysis
} from '../services/codebaseWikiPipeline'
import {
  attachFormalRunLlmAdvisory,
  shouldAutoInterpretFormalRun,
  shouldIncludeKbContext
} from '../services/formalVerificationInterpret'
import { expandCommandTemplate, finalizeRunRow, runFormalVerificationJob } from '../services/formalVerificationRunner'
import type { RuntimeAdapter } from '../services/runtime'

type CodebaseDeps = {
  db: Database.Database
  store: Store<Record<string, unknown>>
  userData: string
  getRuntime: () => RuntimeAdapter | null
  safeRecordLearningEvent: (args: {
    source: 'electron' | 'intellij-plugin'
    actor: string
    interactionType: 'chat_turn' | 'wiki_extract' | 'deep_learn' | 'plugin_report' | 'tool_outcome'
    payloadRef: string
    summary: string
    details?: Record<string, unknown>
    domainId?: string | null
  }) => void
}

export function registerCodebaseIpc(deps: CodebaseDeps): void {
  const { db, store, userData, getRuntime, safeRecordLearningEvent } = deps
  const formalVerificationLocks = new Set<string>()
  const formalInterpretLocks = new Set<string>()

  function sendFormalVerificationProgress(payload: FormalVerificationProgressPayload): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.CODEBASE_FORMAL_VERIFICATION_PROGRESS, payload)
      }
    }
  }

  function sendCodebaseWikiAnalysisProgress(payload: CodebaseWikiAnalysisProgress): void {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        w.webContents.send(IPC.CODEBASE_WIKI_ANALYSIS_PROGRESS, payload)
      }
    }
  }

  ipcMain.handle(IPC.CODEBASE_FORMAL_GET, () => readCodebaseFormalBundle(store))

  ipcMain.handle(IPC.CODEBASE_FORMAL_PICK_ROOT, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const r = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  const formalAddCodebaseSchema = z.object({
    rootPath: z.string().min(1).max(8192),
    displayName: z.string().max(400).optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_ADD, (_e, raw: unknown) => {
    const parsed = formalAddCodebaseSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const rec = addManualCodebase(store, parsed.data.rootPath, parsed.data.displayName)
    if (!rec) return { ok: false as const, error: 'Path is not an existing directory.' }
    return { ok: true as const, record: rec }
  })

  const formalAddGitCodebaseSchema = z.object({
    gitUrl: z.string().min(4).max(2048),
    displayName: z.string().max(400).optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_ADD_GIT, (_e, raw: unknown) => {
    const parsed = formalAddGitCodebaseSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const r = addCodebaseFromGitUrl({
      store,
      userData,
      gitUrl: parsed.data.gitUrl,
      displayName: parsed.data.displayName
    })
    if (!r.ok) return { ok: false as const, error: r.error }
    const bundle = readCodebaseFormalBundle(store)
    const rec = bundle.codebases.find((c) => c.id === r.recordId)
    if (!rec) return { ok: false as const, error: 'Codebase registered but could not reload record.' }
    return { ok: true as const, record: rec }
  })

  const codebaseWikiAnalyzeSchema = z.object({
    codebaseId: z.string().uuid()
  })

  ipcMain.handle(IPC.CODEBASE_WIKI_ANALYZE, async (_e, raw: unknown) => {
    const parsed = codebaseWikiAnalyzeSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    try {
      const snapshot = await runCodebaseWikiAnalysis({
        db,
        store,
        getRuntime,
        codebaseId: parsed.data.codebaseId,
        onProgress: sendCodebaseWikiAnalysisProgress
      })
      safeRecordLearningEvent({
        source: 'electron',
        actor: 'assistant',
        interactionType: 'tool_outcome',
        payloadRef: `codebase-analysis:${snapshot.codebaseId}:${snapshot.id}`,
        summary: `Codebase wiki enrichment for ${snapshot.rootPath}`,
        details: {
          domainModelCount: snapshot.domainModel.length,
          designPatternCount: snapshot.designPatterns.length,
          architecturePatternCount: snapshot.architecturePatterns.length
        }
      })
      return { ok: true as const, snapshot }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      sendCodebaseWikiAnalysisProgress({ phase: 'error', message: msg })
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(IPC.CODEBASE_WIKI_ANALYSIS_LATEST, () => listLatestCodebaseAnalysisSnapshots(db))

  const formalUpdateCodebaseSchema = z.object({
    id: z.string().uuid(),
    displayName: z.string().max(400).optional(),
    disabled: z.boolean().optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_UPDATE, (_e, raw: unknown) => {
    const parsed = formalUpdateCodebaseSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const rec = updateCodebase(store, parsed.data.id, {
      displayName: parsed.data.displayName,
      disabled: parsed.data.disabled
    })
    if (!rec) return { ok: false as const, error: 'Codebase not found.' }
    return { ok: true as const, record: rec }
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_REMOVE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const, error: 'Invalid id' }
    const ok = removeCodebase(store, id.trim())
    return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'Codebase not found.' } as const)
  })

  const formalProfileAddSchema = z.object({
    label: z.string().min(1).max(200),
    commandTemplate: z.string().min(1).max(8000),
    spawnMode: z.enum(['shell', 'exec']).optional(),
    timeoutMs: z.number().int().min(1000).max(3_600_000).optional(),
    expectedExitCodes: z.array(z.number().int()).min(1).max(24).optional(),
    interpretWithLlm: z.boolean().optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_PROFILE_ADD, (_e, raw: unknown) => {
    const parsed = formalProfileAddSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid profile' }
    const profile: FormalToolProfile = {
      id: randomUUID(),
      label: parsed.data.label,
      commandTemplate: parsed.data.commandTemplate,
      spawnMode: parsed.data.spawnMode ?? (process.platform === 'win32' ? 'shell' : 'exec'),
      timeoutMs: parsed.data.timeoutMs ?? DEFAULT_FORMAL_TOOL_TIMEOUT_MS,
      expectedExitCodes: parsed.data.expectedExitCodes ?? [0],
      ...(typeof parsed.data.interpretWithLlm === 'boolean' ? { interpretWithLlm: parsed.data.interpretWithLlm } : {})
    }
    addFormalProfile(store, profile)
    return { ok: true as const, profile }
  })

  const formalProfileUpdateSchema = z.object({
    id: z.string().uuid(),
    interpretWithLlm: z.enum(['inherit', 'on', 'off'])
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_PROFILE_UPDATE, (_e, raw: unknown) => {
    const parsed = formalProfileUpdateSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const profile = updateFormalProfile(store, parsed.data.id, {
      interpretWithLlm: parsed.data.interpretWithLlm
    })
    if (!profile) return { ok: false as const, error: 'Profile not found.' }
    return { ok: true as const, profile }
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_PROFILE_REMOVE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return { ok: false as const, error: 'Invalid id' }
    const ok = removeFormalProfile(store, id.trim())
    return ok ? ({ ok: true as const } as const) : ({ ok: false as const, error: 'Profile not found.' } as const)
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_LIST, () => {
    const bundle = readCodebaseFormalBundle(store)
    return [...bundle.formalVerificationRuns].sort((a, b) => b.startedAt - a.startedAt)
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_GET, (_e, runId: unknown) => {
    if (typeof runId !== 'string' || !runId.trim()) return null
    const bundle = readCodebaseFormalBundle(store)
    return bundle.formalVerificationRuns.find((r) => r.id === runId.trim()) ?? null
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_EXPORT_JSON, (_e, runId: unknown) => {
    if (typeof runId !== 'string' || !runId.trim()) return { ok: false as const, error: 'Invalid id' }
    const bundle = readCodebaseFormalBundle(store)
    const run = bundle.formalVerificationRuns.find((r) => r.id === runId.trim())
    if (!run) return { ok: false as const, error: 'Run not found.' }
    const payload = {
      disclaimer:
        'Tool-backed bounded formal assurance only. Verdict reflects the configured external command exit code, not universal program correctness.',
      exportedAt: new Date().toISOString(),
      run
    }
    return { ok: true as const, json: JSON.stringify(payload, null, 2) }
  })

  const formalInterpretRunSchema = z.object({
    runId: z.string().uuid(),
    includeContext: z.boolean().optional()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_INTERPRET_RUN, async (_e, raw: unknown) => {
    const parsed = formalInterpretRunSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const runId = parsed.data.runId
    if (formalInterpretLocks.has(runId)) {
      return { ok: false as const, error: 'Interpretation already in progress for this run.' }
    }
    formalInterpretLocks.add(runId)
    try {
      const bundle = readCodebaseFormalBundle(store)
      const run = bundle.formalVerificationRuns.find((r) => r.id === runId)
      if (!run) return { ok: false as const, error: 'Run not found.' }
      if (run.status === 'running') {
        return { ok: false as const, error: 'Run is still in progress.' }
      }
      const profile = bundle.formalToolProfiles.find((p) => p.id === run.profileId)
      const codebase = bundle.codebases.find((c) => c.id === run.codebaseId)
      if (!profile || !codebase) return { ok: false as const, error: 'Profile or codebase missing.' }
      const includeContext = parsed.data.includeContext === true
      const next = await attachFormalRunLlmAdvisory({
        store,
        db,
        getRuntime,
        run,
        profile,
        codebase,
        includeContext
      })
      updateFormalRun(store, next)
      sendFormalVerificationProgress({ runId, phase: 'finished', run: next })
      return { ok: true as const, run: next }
    } finally {
      formalInterpretLocks.delete(runId)
    }
  })

  const formalRunStartSchema = z.object({
    codebaseId: z.string().uuid(),
    profileId: z.string().uuid()
  })

  ipcMain.handle(IPC.CODEBASE_FORMAL_RUN_START, (_event, raw: unknown) => {
    const parsed = formalRunStartSchema.safeParse(raw)
    if (!parsed.success) return { ok: false as const, error: 'Invalid payload' }
    const { codebaseId, profileId } = parsed.data
    if (formalVerificationLocks.has(codebaseId)) {
      return { ok: false as const, error: 'A verification run is already in progress for this codebase.' }
    }
    const bundle = readCodebaseFormalBundle(store)
    const codebase = bundle.codebases.find((c) => c.id === codebaseId)
    const profile = bundle.formalToolProfiles.find((p) => p.id === profileId)
    if (!codebase) return { ok: false as const, error: 'Codebase not found.' }
    if (!profile) return { ok: false as const, error: 'Profile not found.' }
    if (codebase.disabled) return { ok: false as const, error: 'Codebase is disabled.' }

    const cwd = resolve(codebase.rootPath.trim())
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
      return { ok: false as const, error: 'Codebase directory no longer exists.' }
    }

    const commandResolved = expandCommandTemplate(profile.commandTemplate, cwd)
    const runId = randomUUID()
    const startedAt = Date.now()
    const baseRun: FormalVerificationRun = {
      id: runId,
      codebaseId,
      profileId,
      startedAt,
      status: 'running',
      exitCode: null,
      stdout: '',
      stderr: '',
      commandResolved
    }

    formalVerificationLocks.add(codebaseId)
    appendFormalRun(store, baseRun)
    sendFormalVerificationProgress({ runId, phase: 'started', run: baseRun })

    void (async () => {
      const maybeInterpret = async (run: FormalVerificationRun): Promise<FormalVerificationRun> => {
        if (!shouldAutoInterpretFormalRun(store, profile)) return run
        const includeContext = shouldIncludeKbContext(store)
        return attachFormalRunLlmAdvisory({
          store,
          db,
          getRuntime,
          run,
          profile,
          codebase,
          includeContext
        })
      }
      try {
        const expectedExitCodes = profile.expectedExitCodes.length > 0 ? profile.expectedExitCodes : [0]
        const timeoutMs =
          typeof profile.timeoutMs === 'number' && profile.timeoutMs > 0
            ? profile.timeoutMs
            : DEFAULT_FORMAL_TOOL_TIMEOUT_MS
        const result = await runFormalVerificationJob({
          commandResolved,
          cwd,
          spawnMode: profile.spawnMode,
          timeoutMs,
          expectedExitCodes
        })
        let final = finalizeRunRow(baseRun, result)
        updateFormalRun(store, final)
        final = await maybeInterpret(final)
        updateFormalRun(store, final)
        sendFormalVerificationProgress({ runId, phase: 'finished', run: final })
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        let failed: FormalVerificationRun = {
          ...baseRun,
          finishedAt: Date.now(),
          status: 'failed',
          exitCode: null,
          stdout: '',
          stderr: msg.slice(0, 8000)
        }
        updateFormalRun(store, failed)
        failed = await maybeInterpret(failed)
        updateFormalRun(store, failed)
        sendFormalVerificationProgress({ runId, phase: 'finished', run: failed })
      } finally {
        formalVerificationLocks.delete(codebaseId)
      }
    })()

    return { ok: true as const, runId }
  })
}
