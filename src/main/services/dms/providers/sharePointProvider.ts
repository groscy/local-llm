import type { DmsProviderFactory } from '../dmsTypes'
import { authedBinaryRequest, authedJsonRequest } from '../providerHttp'

type GraphDriveItem = {
  id: string
  name: string
  eTag?: string
  size?: number
  folder?: Record<string, unknown>
  file?: { mimeType?: string }
}

type GraphDriveListResponse = {
  value?: GraphDriveItem[]
  '@odata.nextLink'?: string
}

function sharePointDrivePrefix(siteId: string | null): string {
  const sid = siteId?.trim()
  if (!sid) return 'https://graph.microsoft.com/v1.0/sites/root/drive'
  return `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(sid)}/drive`
}

async function listItems(
  firstUrl: string,
  onRequest: (url: string) => Promise<GraphDriveListResponse>
): Promise<GraphDriveItem[]> {
  const out: GraphDriveItem[] = []
  let url = firstUrl
  for (;;) {
    const json = await onRequest(url)
    out.push(...(json.value ?? []))
    url = json['@odata.nextLink'] ?? ''
    if (!url) break
  }
  return out
}

export const createSharePointProvider: DmsProviderFactory = (ctx) => {
  let secret = ctx.secret
  const prefix = sharePointDrivePrefix(ctx.connection.siteId)
  const onRefresh = (next: typeof secret): void => {
    secret = next
    ctx.onSecretRefresh?.(next)
  }
  return {
    listFolders: async () => {
      const items = await listItems(`${prefix}/root/children?$top=200`, async (url) => {
        const res = await authedJsonRequest<GraphDriveListResponse>(url, secret, { onSecretRefresh: onRefresh })
        secret = res.secret
        return res.json
      })
      return items
        .filter((i) => Boolean(i.folder))
        .map((i) => ({ id: i.id, name: i.name, path: i.name }))
    },
    listFolderContents: async (folderId) => {
      const items = await listItems(`${prefix}/items/${encodeURIComponent(folderId)}/children?$top=200`, async (url) => {
        const res = await authedJsonRequest<GraphDriveListResponse>(url, secret, { onSecretRefresh: onRefresh })
        secret = res.secret
        return res.json
      })
      return items.map((i) => ({
        id: i.id,
        name: i.name,
        path: i.name,
        mimeType: i.file?.mimeType,
        etag: i.eTag,
        sizeBytes: typeof i.size === 'number' ? i.size : undefined,
        isFolder: Boolean(i.folder)
      }))
    },
    downloadFile: async (fileId) => {
      const meta = await authedJsonRequest<{ name?: string; file?: { mimeType?: string } }>(
        `${prefix}/items/${encodeURIComponent(fileId)}?$select=id,name,file`,
        secret,
        { onSecretRefresh: onRefresh }
      )
      secret = meta.secret
      const bin = await authedBinaryRequest(`${prefix}/items/${encodeURIComponent(fileId)}/content`, secret, {
        onSecretRefresh: onRefresh
      })
      secret = bin.secret
      return {
        file: {
          id: fileId,
          name: meta.json.name ?? fileId,
          path: meta.json.name ?? fileId,
          mimeType: meta.json.file?.mimeType,
          isFolder: false
        },
        bytes: bin.bytes
      }
    }
  }
}
