/** Main → renderer payloads for `IPC.APP_UPDATE_STATUS`. */

export type AppUpdateStatusPayload =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'not_available'; currentVersion: string }
  | { phase: 'available'; version: string; releaseDate?: string }
  | { phase: 'downloading'; percent: number; transferred: number; total: number }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }
