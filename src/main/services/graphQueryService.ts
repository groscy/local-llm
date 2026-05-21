import type Database from 'better-sqlite3'
import type {
  KeywordGraphNeighborQuery,
  KeywordGraphPayload,
  KeywordGraphQuery,
  KeywordGraphSearchHit,
  KnowledgeGraphPayload,
  SemanticKnowledgeGraphPayload
} from '@shared/types'
import { getKnowledgeGraph, getSemanticKnowledgeGraph } from './kbService'
import { getKeywordGraph, getKeywordGraphNeighbors, searchKeywordGraphNodes } from './keywordGraphService'

export type GraphQueryService = {
  getStructuralGraph: () => KnowledgeGraphPayload
  getSemanticGraph: () => SemanticKnowledgeGraphPayload
  getKeywordGraph: (query?: KeywordGraphQuery) => KeywordGraphPayload
  getKeywordGraphNeighbors: (query: KeywordGraphNeighborQuery) => KeywordGraphPayload
  searchKeywordGraphNodes: (query: string, limit?: number) => KeywordGraphSearchHit[]
}

export function createGraphQueryService(db: Database.Database): GraphQueryService {
  return {
    getStructuralGraph: () => getKnowledgeGraph(db),
    getSemanticGraph: () => getSemanticKnowledgeGraph(db),
    getKeywordGraph: (query) => getKeywordGraph(db, query),
    getKeywordGraphNeighbors: (query) => getKeywordGraphNeighbors(db, query),
    searchKeywordGraphNodes: (query, limit) => searchKeywordGraphNodes(db, query, limit)
  }
}
