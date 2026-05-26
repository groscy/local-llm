import type { AppMainView, WorkspaceStatusLabel } from '@shared/uiRole'
import { APP_MAIN_VIEW_COPY } from '@shared/uiRole'
import type { WorkflowStageId } from '@shared/workflowModel'

export const STAGE_ENTRY_VIEW: Record<WorkflowStageId, AppMainView> = {
  setup: 'architectureRepository',
  operate_runtime: 'chat',
  use_feature: 'chat',
  validate_outcome: 'releasePlanner'
}

export function deriveViewCopyKey(mainView: AppMainView, wikiSubview: 'article' | 'knowledgeGraph'): AppMainView {
  return mainView === 'wiki' && wikiSubview === 'knowledgeGraph' ? 'knowledgeGraph' : mainView
}

export function deriveWorkspaceStatus(args: {
  runtimeStarting: boolean
  runtimeOn: boolean
  modelPath: string
  runtimeLoadMessage?: string | null
}): { state: WorkspaceStatusLabel; hint: string } {
  const trimmedModelPath = args.modelPath.trim()
  if (args.runtimeStarting) {
    return { state: 'Running', hint: args.runtimeLoadMessage ?? 'Model is starting.' }
  }
  if (args.runtimeOn) {
    return { state: 'Ready', hint: 'Model is ready. Open Knowledge to continue the presentation flow.' }
  }
  if (!trimmedModelPath) {
    return { state: 'Needs input', hint: 'Choose a model to begin the presentation flow.' }
  }
  return { state: 'Blocked', hint: 'Start the model from Run or the play button, then open Knowledge.' }
}

export function workflowStageForView(view: AppMainView): WorkflowStageId {
  if (view === 'releasePlanner' || view === 'codebaseLandscape') return 'validate_outcome'
  if (view === 'chat' || view === 'wiki' || view === 'knowledgeGraph' || view === 'ontology' || view === 'train') {
    return 'use_feature'
  }
  if (view === 'architectureRepository' || view === 'electronDev') return 'setup'
  return 'use_feature'
}

export function viewCopyFor(view: AppMainView): { title: string; subtitle: string } {
  return APP_MAIN_VIEW_COPY[view] ?? APP_MAIN_VIEW_COPY.chat
}
