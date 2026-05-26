import type { AppMainView } from '@shared/uiRole'

export type FeatureRouteDefinition = {
  id: AppMainView
  title: string
  icon: string
  heavy: boolean
}

/**
 * Canonical route registry for the app shell.
 * Keeps route metadata in one place so navigation and lazy-loading decisions stay aligned.
 */
export const FEATURE_ROUTE_REGISTRY: Record<AppMainView, FeatureRouteDefinition> = {
  chat: { id: 'chat', title: 'Conversation', icon: 'fa-comments', heavy: false },
  wiki: { id: 'wiki', title: 'Knowledge', icon: 'fa-book-open', heavy: false },
  train: { id: 'train', title: 'Training', icon: 'fa-flask', heavy: true },
  releasePlanner: { id: 'releasePlanner', title: 'Release', icon: 'fa-rocket', heavy: false },
  architectureRepository: { id: 'architectureRepository', title: 'Architecture', icon: 'fa-sitemap', heavy: true },
  knowledgeGraph: { id: 'knowledgeGraph', title: 'Graph', icon: 'fa-project-diagram', heavy: true },
  ontology: { id: 'ontology', title: 'Ontology', icon: 'fa-network-wired', heavy: true },
  codebaseLandscape: { id: 'codebaseLandscape', title: 'Validation', icon: 'fa-layer-group', heavy: true },
  electronDev: { id: 'electronDev', title: 'Develop', icon: 'fa-code', heavy: true }
}

export function isHeavyFeatureRoute(view: AppMainView): boolean {
  return FEATURE_ROUTE_REGISTRY[view].heavy
}
