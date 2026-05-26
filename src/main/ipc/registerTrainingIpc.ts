import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type Database from 'better-sqlite3'
import { IPC } from '@shared/ipc'
import * as trainOrchestrator from '../services/trainOrchestrator'
import {
  buildManifestFromApproved,
  listDomainModelVersions,
  listDomainProfiles,
  listEvidenceCards,
  upsertDomainProfile,
  updateEvidenceCardStatus
} from '../services/trainingWorkflowStore'

type TrainingDeps = {
  db: Database.Database
  userData: string
  modelsDir: () => string
}

export function registerTrainingIpc(deps: TrainingDeps): void {
  const { db, userData, modelsDir } = deps

  ipcMain.handle(IPC.TRAIN_BASE_FOR_FINETUNE_PATH, (_e, raw: unknown) => {
    const p = typeof raw === 'string' ? raw.trim() : ''
    if (!p) return { baseModelPath: null as string | null }
    const base = trainOrchestrator.findBaseModelForFinetuneArtifact(db, p)
    return { baseModelPath: base ?? null }
  })

  ipcMain.handle(IPC.TRAIN_START, (_e, raw: unknown) => {
    const p = raw as {
      baseModelPath?: string
      datasetPath?: string
      kbSourceIds?: string[]
      claudeSessionIds?: string[]
      displayName?: string
      domainId?: string
    }
    const base = typeof p.baseModelPath === 'string' ? p.baseModelPath.trim() : ''
    if (!base) throw new Error('Base model path is required (GGUF or model id you fine-tune from).')
    const kbSourceIds = Array.isArray(p.kbSourceIds)
      ? p.kbSourceIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined
    const claudeSessionIds = Array.isArray(p.claudeSessionIds)
      ? p.claudeSessionIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined
    return trainOrchestrator.startTrainJob(db, userData, {
      baseModelPath: base,
      datasetPath: typeof p.datasetPath === 'string' && p.datasetPath.trim() ? p.datasetPath.trim() : undefined,
      kbSourceIds,
      claudeSessionIds,
      displayName: typeof p.displayName === 'string' ? p.displayName : undefined,
      domainId: typeof p.domainId === 'string' && p.domainId.trim() ? p.domainId.trim() : undefined,
      modelsDir: modelsDir()
    })
  })

  ipcMain.handle(IPC.TRAIN_VALIDATE_START, (_e, raw: unknown) => {
    const p = z
      .object({
        baseModelPath: z.string().min(1)
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Base model path is required.')
    return trainOrchestrator.validateTrainStart(p.data.baseModelPath)
  })

  ipcMain.handle(IPC.TRAIN_STATUS, (_e, id: string) => trainOrchestrator.getTrainJob(db, id))
  ipcMain.handle(IPC.TRAIN_LIST_JOBS, () => trainOrchestrator.listTrainJobs(db))
  ipcMain.handle(IPC.TRAIN_RESCAN_ARTIFACT, (_e, jobId: unknown) => {
    if (typeof jobId !== 'string' || !jobId.trim()) throw new Error('Job id is required')
    const r = trainOrchestrator.rescanTrainJobArtifacts(db, jobId.trim(), modelsDir())
    if (!r) throw new Error('Train job not found')
    return r
  })
  ipcMain.handle(IPC.TRAIN_REVIEW_QUEUE, (_e, raw?: unknown) => {
    const p = z
      .object({
        status: z.enum(['pending', 'approved', 'rejected']).optional(),
        domainId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(400).optional()
      })
      .safeParse(raw ?? {})
    if (!p.success) return listEvidenceCards(db, { limit: 120 })
    return listEvidenceCards(db, {
      status: p.data.status,
      domainId: p.data.domainId,
      limit: p.data.limit
    })
  })
  ipcMain.handle(IPC.TRAIN_REVIEW_SET_STATUS, (_e, raw: unknown) => {
    const p = z
      .object({
        cardId: z.string().uuid(),
        status: z.enum(['pending', 'approved', 'rejected'])
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid review status payload')
    const next = updateEvidenceCardStatus(db, p.data.cardId, p.data.status)
    if (!next) throw new Error('Evidence card not found')
    return next
  })
  ipcMain.handle(IPC.TRAIN_MANIFEST_PREVIEW, (_e, raw: unknown) => {
    const p = z
      .object({
        id: z.string().uuid().optional(),
        domainId: z.string().uuid().optional(),
        baseModelPath: z.string().min(1),
        datasetPath: z.string().min(1),
        outputDir: z.string().min(1),
        sourceIds: z.array(z.string().min(1)).optional()
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid manifest preview payload')
    return buildManifestFromApproved(db, {
      id: p.data.id ?? randomUUID(),
      domainId: p.data.domainId ?? null,
      baseModelPath: p.data.baseModelPath,
      datasetPath: p.data.datasetPath,
      outputDir: p.data.outputDir,
      sourceIds: p.data.sourceIds
    })
  })
  ipcMain.handle(IPC.TRAIN_DOMAIN_PROFILES_LIST, () => listDomainProfiles(db))
  ipcMain.handle(IPC.TRAIN_DOMAIN_PROFILE_UPSERT, (_e, raw: unknown) => {
    const p = z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(200),
        terminology: z.array(z.string().min(1).max(64)).max(120),
        objective: z.string().max(1000).default(''),
        allowedSources: z.array(z.enum(['electron', 'intellij-plugin'])).min(1).max(2),
        retentionDays: z.number().int().min(1).max(3650).default(90)
      })
      .safeParse(raw)
    if (!p.success) throw new Error('Invalid domain profile payload')
    return upsertDomainProfile(db, p.data)
  })
  ipcMain.handle(IPC.TRAIN_DOMAIN_MODEL_VERSIONS, (_e, raw?: unknown) => {
    const p = z.object({ domainId: z.string().uuid().optional() }).safeParse(raw ?? {})
    return listDomainModelVersions(db, p.success ? p.data.domainId : undefined)
  })
}
