import { safeStorage } from 'electron'
import type Store from 'electron-store'
import type { DmsConnectionSecret } from './dmsTypes'

const DMS_SECRETS_STORE_KEY = 'dmsSecretsEncrypted'

type SecretsMap = Record<string, DmsConnectionSecret>

function decodeSecrets(raw: string): SecretsMap {
  if (!raw) return {}
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buf = Buffer.from(raw, 'base64')
      const json = safeStorage.decryptString(buf)
      const parsed = JSON.parse(json) as SecretsMap
      return parsed && typeof parsed === 'object' ? parsed : {}
    }
    const parsed = JSON.parse(raw) as SecretsMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function encodeSecrets(map: SecretsMap): string {
  const json = JSON.stringify(map)
  if (!safeStorage.isEncryptionAvailable()) return json
  const buf = safeStorage.encryptString(json)
  return Buffer.from(buf).toString('base64')
}

export function loadDmsSecrets(store: Store<Record<string, unknown>>): SecretsMap {
  const raw = store.get(DMS_SECRETS_STORE_KEY)
  return typeof raw === 'string' ? decodeSecrets(raw) : {}
}

export function readDmsSecret(
  store: Store<Record<string, unknown>>,
  tokenRef: string
): DmsConnectionSecret | null {
  const map = loadDmsSecrets(store)
  return map[tokenRef] ?? null
}

export function upsertDmsSecret(
  store: Store<Record<string, unknown>>,
  tokenRef: string,
  secret: DmsConnectionSecret
): void {
  const map = loadDmsSecrets(store)
  map[tokenRef] = secret
  store.set(DMS_SECRETS_STORE_KEY, encodeSecrets(map))
}

export function removeDmsSecret(store: Store<Record<string, unknown>>, tokenRef: string): void {
  const map = loadDmsSecrets(store)
  if (!(tokenRef in map)) return
  delete map[tokenRef]
  store.set(DMS_SECRETS_STORE_KEY, encodeSecrets(map))
}
