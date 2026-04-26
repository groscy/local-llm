import { describe, expect, it } from 'vitest'
import { IPC } from './ipc'

describe('IPC DMS channels', () => {
  it('defines all DMS integration channels', () => {
    expect(IPC.DMS_CONNECT_START).toBe('dms:connectStart')
    expect(IPC.DMS_CONNECT_COMPLETE).toBe('dms:connectComplete')
    expect(IPC.DMS_CONNECTIONS_LIST).toBe('dms:connectionsList')
    expect(IPC.DMS_FOLDERS_LIST).toBe('dms:foldersList')
    expect(IPC.DMS_IMPORT_START).toBe('dms:importStart')
    expect(IPC.DMS_SYNC_RUN).toBe('dms:syncRun')
    expect(IPC.DMS_SYNC_PROGRESS).toBe('dms:syncProgress')
    expect(IPC.DMS_DISCONNECT).toBe('dms:disconnect')
  })
})

describe('IPC ontology channels', () => {
  it('defines ontology query and maintenance channels', () => {
    expect(IPC.ONTOLOGY_STATS).toBe('ontology:stats')
    expect(IPC.ONTOLOGY_QUERY_SUBGRAPH).toBe('ontology:querySubgraph')
    expect(IPC.ONTOLOGY_ENTITY_DETAILS).toBe('ontology:entityDetails')
    expect(IPC.ONTOLOGY_REBUILD).toBe('ontology:rebuild')
    expect(IPC.ONTOLOGY_EXPORT).toBe('ontology:export')
  })
})
