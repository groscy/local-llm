/** Bump when first-run setup tour content changes; user sees tour until version matches. */
export const SETUP_TOUR_LATEST = 3

/** Bump when welcome checklist copy changes; kept in sync with renderer onboarding. */
export const WELCOME_GUIDE_LATEST = 3

export const UI_ROLE_IDS = [
  'software_developer',
  'software_architect',
  'business_analyst',
  'tester',
  'builder_admin'
] as const

export type UiRole = (typeof UI_ROLE_IDS)[number]

export const DEFAULT_UI_ROLE: UiRole = 'software_developer'

export function parseUiRole(v: unknown): UiRole | null {
  if (typeof v !== 'string') return null
  return (UI_ROLE_IDS as readonly string[]).includes(v) ? (v as UiRole) : null
}

export function parseUiRoleOrDefault(v: unknown): UiRole {
  return parseUiRole(v) ?? DEFAULT_UI_ROLE
}

export type MainShellView =
  | 'chat'
  | 'wiki'
  | 'train'
  | 'releasePlanner'
  | 'architectureRepository'
  | 'knowledgeGraph'
  | 'ontology'
  /** Registered implementation roots and formal verification run history. */
  | 'codebaseLandscape'

export type ToolDrawerId = 'hf' | 'runtime' | 'train' | 'metrics'

export const SETTINGS_SECTION_IDS = [
  'general',
  'appearance',
  'chat',
  'runtime',
  'integrations',
  'widgets',
  'data',
  'maintenance'
] as const

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number]

export const WORKSPACE_DENSITY_IDS = ['focused', 'standard', 'expanded'] as const
export type WorkspaceDensity = (typeof WORKSPACE_DENSITY_IDS)[number]

export function parseWorkspaceDensity(v: unknown): WorkspaceDensity {
  return (typeof v === 'string' && (WORKSPACE_DENSITY_IDS as readonly string[]).includes(v)
    ? v
    : 'standard') as WorkspaceDensity
}

/** Main area view id including the Dev shell (see `devShellChromeVisible`). */
export type AppMainView = MainShellView | 'electronDev'
export const PRESENTATION_CORE_MAIN_VIEWS: readonly AppMainView[] = ['chat', 'wiki', 'train', 'releasePlanner']
export const ADVANCED_MAIN_VIEWS: readonly AppMainView[] = [
  'ontology',
  'architectureRepository',
  'codebaseLandscape',
  'electronDev'
]

/** Shared action vocabulary used across onboarding, rail navigation, and header CTAs. */
export const UI_ACTION_LABELS = {
  run: 'Run',
  metrics: 'Metrics',
  settings: 'Settings',
  open: 'Open',
  configure: 'Configure',
  validate: 'Validate',
  capture: 'Capture'
} as const

/** Canonical workspace state labels surfaced in status chips and guidance hints. */
export const WORKSPACE_STATUS_LABELS = ['Ready', 'Running', 'Blocked', 'Needs input'] as const
export type WorkspaceStatusLabel = (typeof WORKSPACE_STATUS_LABELS)[number]

/** Canonical user-facing feedback variants; keep aligned with toast + banner semantics. */
export const UI_FEEDBACK_VARIANTS = ['info', 'success', 'warning', 'error'] as const

export type RoleTaskNavItem = {
  id: string
  label: string
  hint: string
  icon: string
  mainView?: AppMainView
  drawer?: ToolDrawerId | 'settings'
  settingsSection?: SettingsSectionId
}

export type SetupTourAction = {
  label: string
  openDrawer: ToolDrawerId | 'settings' | null
  mainView?: AppMainView
  settingsSection?: SettingsSectionId
}

export type RoleTourChecklist = {
  title: string
  steps: readonly [string, string, string]
  footnote: string
  primaryAction: SetupTourAction
  secondaryAction: SetupTourAction
}

export type RoleLayout = {
  mainViews: MainShellView[]
  toolDrawers: ToolDrawerId[]
  defaultMainView: MainShellView
  /** Task-first navigation shown in the left rail. */
  taskNav: RoleTaskNavItem[]
  /** Which settings sections are visible for this role. */
  settingsSections: SettingsSectionId[]
  /** Controls initial information density in the shell. */
  defaultDensity: WorkspaceDensity
  /** Toggles expanded settings/details without extra clicks. */
  advancedSettingsByDefault?: boolean
  /** Preferred shell when resetting / first open (e.g. Dev hub for Software developer). */
  defaultAppMainView?: AppMainView
  /** When true, the Chat main view is not used; use Wiki, Dev hub, and tools instead. */
  hideChatMainView?: boolean
  /** Short line after role pick in setup tour. */
  tourTip: string
  /** Primary CTA label on the tip step. */
  tourCtaPrimaryLabel: string
  /** Optional secondary (skip-style). */
  tourCtaSecondaryLabel?: string
  /** What the secondary button does (default: go to final checklist step). */
  tourSecondaryBehavior?: 'next_step' | 'open_runtime_finish' | 'open_settings_finish'
  /** Applied once when the user finishes the setup tour (merge into setConfig). */
  defaultPinnedWidgets?: Partial<{
    metricsPinned: boolean
    downloadsPinned: boolean
    activityPinned: boolean
    issuesPinned: boolean
  }>
  /** Role-specific final checklist shown in setup tour step 5. */
  tourChecklist: RoleTourChecklist
}

const LAYOUTS: Record<UiRole, RoleLayout> = {
  software_developer: {
    mainViews: ['wiki', 'ontology', 'codebaseLandscape', 'train'],
    toolDrawers: ['hf', 'runtime', 'metrics'],
    defaultMainView: 'wiki',
    taskNav: [
      { id: 'develop', label: 'Develop', hint: 'Developer hub and bridge tooling', icon: 'fa-code', mainView: 'electronDev' },
      { id: 'build', label: 'Build', hint: 'Codebases and implementation flow', icon: 'fa-hammer', mainView: 'codebaseLandscape' },
      { id: 'explore', label: 'Explore', hint: 'Search and capture in wiki', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'ontology', label: 'Ontology', hint: 'Runtime domain knowledge graph', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'tune', label: 'Train', hint: 'Fine-tune local models', icon: 'fa-flask', mainView: 'train' }
    ],
    settingsSections: ['general', 'appearance', 'runtime', 'integrations', 'widgets'],
    defaultDensity: 'focused',
    advancedSettingsByDefault: true,
    defaultAppMainView: 'electronDev',
    hideChatMainView: true,
    tourTip:
      'Start from the Developer hub for bridge and tooling, then use Wiki and Run. The in-app Chat view is hidden for this role; use your IDE plugin or switch roles if needed.',
    tourCtaPrimaryLabel: 'Open Developer hub',
    tourCtaSecondaryLabel: 'Open Run instead',
    tourSecondaryBehavior: 'open_runtime_finish',
    defaultPinnedWidgets: {},
    tourChecklist: {
      title: 'Launch your development workspace',
      steps: [
        'Open Run to verify Ollama or llama-server paths before coding.',
        'Select a model and start it from the top bar (green status confirms readiness).',
        'Open Develop to finish plugin bridge checks and keep work anchored to code.'
      ],
      footnote: 'You can reopen this setup tour from Settings -> General -> First-time tips.',
      primaryAction: { label: 'Open Develop & finish', openDrawer: null, mainView: 'electronDev' },
      secondaryAction: { label: "I'm ready", openDrawer: null }
    }
  },
  software_architect: {
    mainViews: ['chat', 'wiki', 'ontology', 'codebaseLandscape', 'architectureRepository', 'train'],
    toolDrawers: ['hf', 'runtime'],
    defaultMainView: 'architectureRepository',
    taskNav: [
      { id: 'structure', label: 'Structure', hint: 'Author architecture repository deliverables', icon: 'fa-sitemap', mainView: 'architectureRepository' },
      { id: 'explore', label: 'Context', hint: 'Capture decisions and rationale in wiki', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'validate', label: 'Validate', hint: 'Review implementation evidence and formal runs', icon: 'fa-layer-group', mainView: 'codebaseLandscape' },
      { id: 'discuss', label: 'Discuss', hint: 'Resolve trade-offs with assistant reasoning', icon: 'fa-comments', mainView: 'chat' }
    ],
    settingsSections: ['general', 'appearance', 'runtime', 'chat', 'data'],
    defaultDensity: 'standard',
    tourTip: 'Start from Structure for architecture outputs, then use Context and Trace to keep decisions explainable and auditable.',
    tourCtaPrimaryLabel: 'Open Structure',
    tourCtaSecondaryLabel: 'Open Run instead',
    tourSecondaryBehavior: 'open_runtime_finish',
    defaultPinnedWidgets: {},
    tourChecklist: {
      title: 'Ship an architecture narrative quickly',
      steps: [
        'Open Structure and confirm the repository scan root for your active project.',
        'Capture key constraints in Context (Wiki), then verify relationships in Trace.',
        'Use Validate to show implementation evidence aligned with architecture decisions.'
      ],
      footnote: 'Keep this focused setup tour available from Settings -> General -> First-time tips.',
      primaryAction: { label: 'Open Structure & finish', openDrawer: null, mainView: 'architectureRepository' },
      secondaryAction: { label: 'Open Run & finish', openDrawer: 'runtime' }
    }
  },
  business_analyst: {
    mainViews: ['chat', 'wiki', 'ontology', 'train'],
    toolDrawers: ['hf', 'runtime'],
    defaultMainView: 'chat',
    taskNav: [
      { id: 'ask', label: 'Ask', hint: 'Conversation-first analysis', icon: 'fa-comments', mainView: 'chat' },
      { id: 'capture', label: 'Capture', hint: 'Summaries in wiki pages', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'ontology', label: 'Ontology', hint: 'Reusable domain concepts', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'train', label: 'Train', hint: 'Run focused domain tuning workflows', icon: 'fa-flask', mainView: 'train' }
    ],
    settingsSections: ['general', 'appearance', 'runtime'],
    defaultDensity: 'standard',
    tourTip: 'Chat for Q&A and Wiki for structured notes. Run starts your local model when you are ready.',
    tourCtaPrimaryLabel: 'Open Run',
    tourCtaSecondaryLabel: 'Continue',
    defaultPinnedWidgets: {
      metricsPinned: false,
      downloadsPinned: false,
      activityPinned: false,
      issuesPinned: false
    },
    tourChecklist: {
      title: 'Get to a business answer fast',
      steps: [
        'Open Run to confirm a model is reachable.',
        'Ask in Chat, then capture reusable findings in Wiki.',
        'Promote high-value terms in Ontology for consistent language.'
      ],
      footnote: 'You can relaunch this setup tour from Settings -> General -> First-time tips.',
      primaryAction: { label: 'Open Chat & finish', openDrawer: null, mainView: 'chat' },
      secondaryAction: { label: 'Open Run & finish', openDrawer: 'runtime' }
    }
  },
  tester: {
    mainViews: ['chat', 'wiki', 'ontology', 'codebaseLandscape', 'train'],
    toolDrawers: ['hf', 'runtime', 'metrics'],
    defaultMainView: 'chat',
    taskNav: [
      { id: 'validate', label: 'Validate', hint: 'Run checks and inspect codebases', icon: 'fa-vial', mainView: 'codebaseLandscape' },
      { id: 'investigate', label: 'Investigate', hint: 'Chat and reproduce failure context', icon: 'fa-bug', mainView: 'chat' },
      { id: 'ontology', label: 'Ontology', hint: 'Runtime facts with provenance', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'capture', label: 'Capture', hint: 'Wiki notes for regression history', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'train', label: 'Train', hint: 'Validate training jobs and evidence quality', icon: 'fa-flask', mainView: 'train' }
    ],
    settingsSections: ['general', 'appearance', 'runtime', 'widgets', 'chat'],
    defaultDensity: 'standard',
    tourTip: 'Use Metrics while exercising flows; plugin traffic is under Settings -> Integrations. Pin Issues from the shell if you track defects there.',
    tourCtaPrimaryLabel: 'Open Run',
    tourCtaSecondaryLabel: 'Continue',
    defaultPinnedWidgets: {
      metricsPinned: true,
      issuesPinned: true,
      activityPinned: true,
      downloadsPinned: false
    },
    tourChecklist: {
      title: 'Validate quality with evidence',
      steps: [
        'Open Run and start the model used for test analysis.',
        'Use Validate and Trace to correlate failures with code context.',
        'Capture defects and regression notes in Wiki for repeatability.'
      ],
      footnote: 'You can reopen this setup tour from Settings -> General -> First-time tips.',
      primaryAction: { label: 'Open Validate & finish', openDrawer: null, mainView: 'codebaseLandscape' },
      secondaryAction: { label: 'Open Run & finish', openDrawer: 'runtime' }
    }
  },
  builder_admin: {
    mainViews: ['chat', 'wiki', 'ontology', 'codebaseLandscape', 'architectureRepository', 'train', 'releasePlanner'],
    toolDrawers: ['hf', 'runtime', 'train', 'metrics'],
    defaultMainView: 'wiki',
    defaultAppMainView: 'electronDev',
    taskNav: [
      { id: 'develop', label: 'Develop', hint: 'App diagnostics and integration hub', icon: 'fa-code', mainView: 'electronDev' },
      { id: 'release', label: 'Release', hint: 'Feature readiness and release feature set', icon: 'fa-rocket', mainView: 'releasePlanner' },
      { id: 'build', label: 'Build', hint: 'Codebase landscape and formal runs', icon: 'fa-hammer', mainView: 'codebaseLandscape' },
      { id: 'structure', label: 'Structure', hint: 'Architecture repository workflows', icon: 'fa-sitemap', mainView: 'architectureRepository' },
      { id: 'explore', label: 'Explore', hint: 'Wiki and source context', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'chat', label: 'Chat', hint: 'Assistant workspace and conversation history', icon: 'fa-comments', mainView: 'chat' },
      { id: 'ontology', label: 'Ontology', hint: 'Runtime ontology and confidence', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'tune', label: 'Tune', hint: 'Training, tuning, and run telemetry', icon: 'fa-flask', mainView: 'train' },
      { id: 'settings', label: 'Configure', hint: 'All settings and maintenance', icon: 'fa-gear', drawer: 'settings', settingsSection: 'general' }
    ],
    settingsSections: [...SETTINGS_SECTION_IDS],
    defaultDensity: 'expanded',
    advancedSettingsByDefault: true,
    tourTip: 'Builder/Admin unlocks all views, diagnostics, and settings for developing and tuning this Electron app.',
    tourCtaPrimaryLabel: 'Open Developer hub',
    tourCtaSecondaryLabel: 'Open all settings',
    tourSecondaryBehavior: 'open_settings_finish',
    defaultPinnedWidgets: {
      metricsPinned: true,
      downloadsPinned: true,
      activityPinned: true,
      issuesPinned: true
    },
    tourChecklist: {
      title: 'Prepare the full workspace',
      steps: [
        'Open Developer hub to verify bridge and plugin health.',
        'Open Run to confirm runtime paths and base model readiness.',
        'Use Configure to finalize global defaults for this workstation.'
      ],
      footnote: 'Reopen this setup tour from Settings -> General -> First-time tips when needed.',
      primaryAction: { label: 'Open Developer hub & finish', openDrawer: null, mainView: 'electronDev' },
      secondaryAction: { label: 'Open Settings & finish', openDrawer: 'settings', mainView: 'electronDev' }
    }
  }
}

export function roleLayout(role: UiRole): RoleLayout {
  return LAYOUTS[role] ?? LAYOUTS.software_developer
}

/** Default main-area view for a layout (Dev hub vs wiki vs chat). */
export function layoutDefaultMainArea(layout: RoleLayout): AppMainView {
  return layout.defaultAppMainView ?? layout.defaultMainView
}

export const UI_ROLE_LABELS: Record<UiRole, string> = {
  software_developer: 'Software developer',
  software_architect: 'Software architect',
  business_analyst: 'Business analyst',
  tester: 'Tester / QA',
  builder_admin: 'Builder / Admin'
}

export const UI_ROLE_CARD_BLURBS: Record<UiRole, string> = {
  software_developer: 'Run a focused setup-to-train workflow with fast access to runtime controls and release checks.',
  software_architect: 'Guide decisions from knowledge capture through implementation evidence and release readiness.',
  business_analyst: 'Use a focused ask-capture-train flow that keeps outcomes easy to present.',
  tester: 'Validate runtime behavior, training quality, and release confidence with fewer navigation hops.',
  builder_admin: 'Operate the full workspace while still supporting presentation-focused defaults.'
}

export const APP_MAIN_VIEW_COPY: Record<AppMainView, { title: string; subtitle: string }> = {
  chat: {
    title: 'Conversation workspace',
    subtitle: 'Work through decisions with local AI reasoning that stays on this device.'
  },
  wiki: {
    title: 'Knowledge library',
    subtitle: 'Capture durable decisions, source snippets, and graph-backed implementation rationale.'
  },
  knowledgeGraph: {
    title: 'Knowledge graph',
    subtitle: 'Inspect relationship traces between wiki topics, chunks, and evidence links.'
  },
  ontology: {
    title: 'Runtime ontology',
    subtitle: 'Inspect reusable entities, provenance, and confidence over time.'
  },
  codebaseLandscape: {
    title: 'Implementation validation',
    subtitle: 'Track codebase scope and formal verification outcomes for architecture confidence.'
  },
  architectureRepository: {
    title: 'Architecture repository',
    subtitle: 'Create TOGAF-aligned artifacts connected to live project evidence.'
  },
  train: {
    title: 'Training workflow',
    subtitle: 'Fine-tune domain models from approved local datasets and knowledge sources.'
  },
  releasePlanner: {
    title: 'Release readiness',
    subtitle: 'Review feature maturity and choose the feature set for the next public release.'
  },
  electronDev: {
    title: 'Developer hub',
    subtitle: 'Bridge health, plugin setup, and diagnostics for engineering workflows.'
  }
}

/** Dev rail + main view: unpackaged/forced dev UI, or Software developer role in any build. */
export function devShellChromeVisible(role: UiRole, unpackagedOrForcedDevUi: boolean): boolean {
  return unpackagedOrForcedDevUi || role === 'software_developer' || role === 'builder_admin'
}

export function roleTaskNav(role: UiRole): readonly RoleTaskNavItem[] {
  return roleLayout(role).taskNav
}

export function roleSettingsSections(role: UiRole): readonly SettingsSectionId[] {
  return roleLayout(role).settingsSections
}

export function isAdvancedMainView(view: AppMainView): boolean {
  return ADVANCED_MAIN_VIEWS.includes(view)
}

export function clampMainViewForLayout(
  mv: AppMainView,
  layout: RoleLayout,
  devShellChrome: boolean
): AppMainView {
  const fallback = layoutDefaultMainArea(layout)
  if (mv === 'electronDev') return devShellChrome ? mv : fallback
  if (layout.hideChatMainView === true && mv === 'chat') return fallback
  if (devShellChrome && mv === 'wiki' && !layout.mainViews.includes('wiki')) return mv
  if (layout.mainViews.includes(mv as MainShellView)) return mv
  return fallback
}
