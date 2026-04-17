/** Checklist for the IntelliJ plugin journey in the desktop app; persisted in electron-store. */
export type IdeJourneyChecklist = {
  backendReady: boolean
  pluginInstalled: boolean
  intellijConfigured: boolean
  firstIdeChat: boolean
}

export function defaultIdeJourneyChecklist(): IdeJourneyChecklist {
  return {
    backendReady: false,
    pluginInstalled: false,
    intellijConfigured: false,
    firstIdeChat: false
  }
}

export function mergeIdeJourneyChecklist(prev: unknown, patch: Partial<IdeJourneyChecklist>): IdeJourneyChecklist {
  const base = defaultIdeJourneyChecklist()
  const cur =
    prev && typeof prev === 'object' && !Array.isArray(prev)
      ? { ...base, ...(prev as Partial<IdeJourneyChecklist>) }
      : base
  return { ...cur, ...patch }
}

export type BridgeSelfTestStep = {
  id: string
  ok: boolean
  detail: string
}

export type IntegrationBridgeSmokeChat = {
  ok: boolean
  httpStatus?: number
  detail: string
}

/** Result of integrationBridgeSelfTest (health + /v1/runtime/status; optional smoke POST /v1/chat). */
export type IntegrationBridgeSelfTestResult = {
  ok: boolean
  summary: string
  steps: BridgeSelfTestStep[]
  smokeChat?: IntegrationBridgeSmokeChat | null
}
