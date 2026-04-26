import type { DmsProviderFactory } from '../dmsTypes'
import { authedBinaryRequest, authedJsonRequest } from '../providerHttp'

type GoogleFile = {
  id: string
  name: string
  mimeType?: string
  md5Checksum?: string
  size?: string
}

type GoogleListResponse = {
  files?: GoogleFile[]
  nextPageToken?: string
}

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder'

async function listFilesByQuery(
  query: string,
  onRequest: (url: string) => Promise<GoogleListResponse>
): Promise<GoogleFile[]> {
  const out: GoogleFile[] = []
  let pageToken = ''
  for (;;) {
    const params = new URLSearchParams({
      q: query,
      pageSize: '200',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      fields: 'nextPageToken,files(id,name,mimeType,md5Checksum,size)'
    })
    if (pageToken) params.set('pageToken', pageToken)
    const payload = await onRequest(`https://www.googleapis.com/drive/v3/files?${params.toString()}`)
    out.push(...(payload.files ?? []))
    pageToken = payload.nextPageToken?.trim() ?? ''
    if (!pageToken) break
  }
  return out
}

export const createGoogleDriveProvider: DmsProviderFactory = (ctx) => {
  let secret = ctx.secret
  const onRefresh = (next: typeof secret): void => {
    secret = next
    ctx.onSecretRefresh?.(next)
  }
  return {
    listFolders: async () => {
      const files = await listFilesByQuery(
        `mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`,
        async (url) => {
          const res = await authedJsonRequest<GoogleListResponse>(url, secret, { onSecretRefresh: onRefresh })
          secret = res.secret
          return res.json
        }
      )
      return files.map((f) => ({ id: f.id, name: f.name, path: f.name }))
    },
    listFolderContents: async (folderId) => {
      const escapedId = folderId.replace(/'/g, "\\'")
      const files = await listFilesByQuery(`'${escapedId}' in parents and trashed = false`, async (url) => {
        const res = await authedJsonRequest<GoogleListResponse>(url, secret, { onSecretRefresh: onRefresh })
        secret = res.secret
        return res.json
      })
      return files.map((f) => ({
        id: f.id,
        name: f.name,
        path: f.name,
        mimeType: f.mimeType,
        etag: f.md5Checksum,
        sizeBytes: Number.isFinite(Number(f.size)) ? Number(f.size) : undefined,
        isFolder: f.mimeType === GOOGLE_FOLDER_MIME
      }))
    },
    downloadFile: async (fileId) => {
      const res = await authedBinaryRequest(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        secret,
        { onSecretRefresh: onRefresh }
      )
      secret = res.secret
      return {
        file: { id: fileId, name: fileId, path: fileId, isFolder: false },
        bytes: res.bytes
      }
    }
  }
}
