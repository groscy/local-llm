import type { AppMainView, UiRole } from './uiRole'

export type WorkflowStageId = 'setup' | 'operate_runtime' | 'use_feature' | 'validate_outcome'
export type FeatureMaturity = 'completed' | 'preview'

export type WorkflowStage = {
  id: WorkflowStageId
  label: string
  icon: string
  guidance: string
}

export type RoleWorkflow = {
  role: UiRole
  stages: readonly WorkflowStage[]
}

export type FeatureMaturityRecord = {
  id: string
  view: AppMainView
  label: string
  maturity: FeatureMaturity
  note: string
}

export const CANONICAL_WORKFLOW_STAGES: readonly WorkflowStage[] = [
  {
    id: 'setup',
    label: 'Setup',
    icon: 'fa-sliders',
    guidance: 'Confirm role defaults, directories, and baseline settings.'
  },
  {
    id: 'operate_runtime',
    label: 'Operate runtime',
    icon: 'fa-microchip',
    guidance: 'Start a local runtime and verify model readiness.'
  },
  {
    id: 'use_feature',
    label: 'Use feature',
    icon: 'fa-compass',
    guidance: 'Execute the selected task flow with focused UI context.'
  },
  {
    id: 'validate_outcome',
    label: 'Validate outcome',
    icon: 'fa-clipboard-check',
    guidance: 'Review evidence, quality signals, and release readiness.'
  }
]

export const ROLE_WORKFLOW_MAP: Record<UiRole, RoleWorkflow> = {
  software_developer: { role: 'software_developer', stages: CANONICAL_WORKFLOW_STAGES },
  software_architect: { role: 'software_architect', stages: CANONICAL_WORKFLOW_STAGES },
  business_analyst: { role: 'business_analyst', stages: CANONICAL_WORKFLOW_STAGES },
  tester: { role: 'tester', stages: CANONICAL_WORKFLOW_STAGES },
  builder_admin: { role: 'builder_admin', stages: CANONICAL_WORKFLOW_STAGES }
}

// Compile-time exhaustiveness check: TypeScript errors here if any UiRole key is absent from ROLE_WORKFLOW_MAP.
export type _AssertAllRolesMapped = typeof ROLE_WORKFLOW_MAP extends Record<UiRole, RoleWorkflow> ? true : never

export const FEATURE_MATURITY_MATRIX: readonly FeatureMaturityRecord[] = [
  {
    id: 'runtime_orchestration',
    view: 'chat',
    label: 'Runtime orchestration',
    maturity: 'completed',
    note: 'Core runtime start/stop and model selection are production paths.'
  },
  {
    id: 'knowledge_capture',
    view: 'wiki',
    label: 'Knowledge capture',
    maturity: 'completed',
    note: 'Wiki ingestion and search are considered complete workflow surfaces.'
  },
  {
    id: 'graph_and_ontology',
    view: 'ontology',
    label: 'Graph and ontology',
    maturity: 'preview',
    note: 'Graph expansion quality and ontology refinement remain active iteration areas.'
  },
  {
    id: 'architecture_and_validation',
    view: 'architectureRepository',
    label: 'Architecture and validation',
    maturity: 'completed',
    note: 'Repository authoring and codebase validation are available for daily use.'
  },
  {
    id: 'training_pipeline',
    view: 'train',
    label: 'Training pipeline',
    maturity: 'preview',
    note: 'Training backends include stubbed execution paths and remain preview.'
  },
  {
    id: 'ide_bridge',
    view: 'electronDev',
    label: 'IDE bridge',
    maturity: 'completed',
    note: 'Bridge transport and plugin telemetry are complete integration surfaces.'
  },
  {
    id: 'observability',
    view: 'releasePlanner',
    label: 'Observability',
    maturity: 'completed',
    note: 'Metrics collection and dashboarding are complete with budget optimizations.'
  },
  {
    id: 'release_distribution',
    view: 'releasePlanner',
    label: 'Release distribution',
    maturity: 'preview',
    note: 'Release scoring remains heuristic-driven and should be treated as preview guidance.'
  }
]

export function featureMaturityById(id: string): FeatureMaturityRecord | null {
  return FEATURE_MATURITY_MATRIX.find((x) => x.id === id) ?? null
}

export function featureMaturityByView(view: AppMainView): FeatureMaturityRecord | null {
  return FEATURE_MATURITY_MATRIX.find((x) => x.view === view) ?? null
}
