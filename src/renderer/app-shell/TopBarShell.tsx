import type { ReactElement } from 'react'
import type { RuntimeLoadProgress, RuntimeStatus } from '@shared/types'
import type { WorkflowStageId } from '@shared/workflowModel'
import { TopBarActions } from './TopBarActions'
import { TopBarRuntimeControls } from './TopBarRuntimeControls'
import { TopBarWorkflowSummary } from './TopBarWorkflowSummary'

type FileModelOption = {
  value: string
  label: string
  loadedOnly: boolean
}

export function TopBarShell(props: {
  title: string
  subtitle?: string
  workspaceStatus: { state: string; hint: string }
  activeWorkflowStage: WorkflowStageId
  runtimeStarting: boolean
  runtimeOn: boolean
  modelPath: string
  topBarModelSelectValue: string
  ollamaChatTagsLoading: boolean
  ollamaChatTagsErr: string | null
  ollamaOptions: string[]
  fileOptions: FileModelOption[]
  runtimeStatus: RuntimeStatus | null
  runtimeLoadProgress: RuntimeLoadProgress | null
  runtimeStatusStale?: boolean
  mainView: string
  mobileConvOpen: boolean
  mobileKbOpen: boolean
  nextBestActionLabel: string
  nextBestActionTitle: string
  onModelChange: (nextModel: string) => void
  onStartRuntime: () => void
  onStopRuntime: () => void
  onOpenRuntimeDrawer: () => void
  onPrimaryAction: () => void
  onStageClick?: (stage: WorkflowStageId) => void
  setMobileConvOpen: (next: boolean | ((prev: boolean) => boolean)) => void
  setMobileKbOpen: (next: boolean | ((prev: boolean) => boolean)) => void
}): ReactElement {
  return (
    <header className="top-bar">
      <TopBarWorkflowSummary
        title={props.title}
        subtitle={props.subtitle}
        workspaceStatus={props.workspaceStatus}
        activeWorkflowStage={props.activeWorkflowStage}
        onStageClick={props.onStageClick}
      />
      <TopBarRuntimeControls
        runtimeStarting={props.runtimeStarting}
        runtimeOn={props.runtimeOn}
        modelPath={props.modelPath}
        topBarModelSelectValue={props.topBarModelSelectValue}
        ollamaChatTagsLoading={props.ollamaChatTagsLoading}
        ollamaChatTagsErr={props.ollamaChatTagsErr}
        ollamaOptions={props.ollamaOptions}
        fileOptions={props.fileOptions}
        runtimeStatus={props.runtimeStatus}
        runtimeLoadProgress={props.runtimeLoadProgress}
        runtimeStatusStale={props.runtimeStatusStale}
        onModelChange={props.onModelChange}
        onStart={props.onStartRuntime}
        onStop={props.onStopRuntime}
      />
      <TopBarActions
        mainView={props.mainView}
        mobileConvOpen={props.mobileConvOpen}
        mobileKbOpen={props.mobileKbOpen}
        runtimeOn={props.runtimeOn}
        nextBestActionLabel={props.nextBestActionLabel}
        nextBestActionTitle={props.nextBestActionTitle}
        setMobileConvOpen={props.setMobileConvOpen}
        setMobileKbOpen={props.setMobileKbOpen}
        openRuntimeDrawer={props.onOpenRuntimeDrawer}
        onPrimaryAction={props.onPrimaryAction}
      />
    </header>
  )
}
