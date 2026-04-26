/** Bump when first-run setup tour content changes; user sees tour until version matches. */
export const SETUP_TOUR_LATEST = 1

/** Bump when welcome checklist copy changes; kept in sync with renderer onboarding. */
export const WELCOME_GUIDE_LATEST = 1

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

export type RoleTaskNavItem = {
  id: string
  label: string
  hint: string
  icon: string
  mainView?: AppMainView
  drawer?: ToolDrawerId | 'settings'
  settingsSection?: SettingsSectionId
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
}

const LAYOUTS: Record<UiRole, RoleLayout> = {
  software_developer: {
    mainViews: ['wiki', 'knowledgeGraph', 'ontology', 'codebaseLandscape', 'train'],
    toolDrawers: ['hf', 'runtime', 'metrics'],
    defaultMainView: 'wiki',
    taskNav: [
      { id: 'develop', label: 'Develop', hint: 'Developer hub and bridge tooling', icon: 'fa-code', mainView: 'electronDev' },
      { id: 'build', label: 'Build', hint: 'Codebases and implementation flow', icon: 'fa-hammer', mainView: 'codebaseLandscape' },
      { id: 'explore', label: 'Explore', hint: 'Search and capture in wiki', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'analyze', label: 'Analyze', hint: 'Graph links and weak context', icon: 'fa-diagram-project', mainView: 'knowledgeGraph' },
      { id: 'ontology', label: 'Ontology', hint: 'Runtime domain knowledge graph', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'tune', label: 'Tune', hint: 'Fine-tune local models', icon: 'fa-flask', mainView: 'train' }
    ],
    settingsSections: ['general', 'appearance', 'runtime', 'integrations', 'widgets'],
    defaultDensity: 'focused',
    advancedSettingsByDefault: true,
    defaultAppMainView: 'electronDev',
    hideChatMainView: true,
    tourTip:
      'Start from the Dev hub for bridge and tooling, then Wiki and Run. The in-app Chat view is hidden for this role — use your IDE plugin or switch role if you need it.',
    tourCtaPrimaryLabel: 'Open Run',
    tourCtaSecondaryLabel: 'Continue',
    defaultPinnedWidgets: {}
  },
  software_architect: {
    mainViews: ['chat', 'wiki', 'knowledgeGraph', 'ontology', 'codebaseLandscape', 'architectureRepository', 'train'],
    toolDrawers: ['hf', 'runtime'],
    defaultMainView: 'wiki',
    taskNav: [
      { id: 'structure', label: 'Structure', hint: 'Architecture repository and evidence', icon: 'fa-sitemap', mainView: 'architectureRepository' },
      { id: 'explore', label: 'Explore', hint: 'Knowledge wiki and decisions', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'graph', label: 'Trace', hint: 'Knowledge graph dependencies', icon: 'fa-diagram-project', mainView: 'knowledgeGraph' },
      { id: 'ontology', label: 'Ontology', hint: 'Runtime ontology and provenance', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'validate', label: 'Validate', hint: 'Codebase and formal run history', icon: 'fa-layer-group', mainView: 'codebaseLandscape' },
      { id: 'chat', label: 'Discuss', hint: 'Reason through alternatives', icon: 'fa-comments', mainView: 'chat' }
    ],
    settingsSections: ['general', 'appearance', 'runtime', 'chat', 'data'],
    defaultDensity: 'standard',
    tourTip: 'Use Wiki and the knowledge graph to capture decisions and context; Models helps compare footprint.',
    tourCtaPrimaryLabel: 'Open Wiki',
    tourCtaSecondaryLabel: 'Open Run instead',
    tourSecondaryBehavior: 'open_runtime_finish',
    defaultPinnedWidgets: {}
  },
  business_analyst: {
    mainViews: ['chat', 'wiki', 'knowledgeGraph', 'ontology', 'codebaseLandscape'],
    toolDrawers: ['hf', 'runtime'],
    defaultMainView: 'chat',
    taskNav: [
      { id: 'ask', label: 'Ask', hint: 'Conversation-first analysis', icon: 'fa-comments', mainView: 'chat' },
      { id: 'capture', label: 'Capture', hint: 'Summaries in wiki pages', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'ontology', label: 'Ontology', hint: 'Reusable domain concepts', icon: 'fa-network-wired', mainView: 'ontology' }
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
    }
  },
  tester: {
    mainViews: ['chat', 'wiki', 'knowledgeGraph', 'ontology', 'codebaseLandscape'],
    toolDrawers: ['hf', 'runtime', 'metrics'],
    defaultMainView: 'chat',
    taskNav: [
      { id: 'validate', label: 'Validate', hint: 'Run checks and inspect codebases', icon: 'fa-vial', mainView: 'codebaseLandscape' },
      { id: 'investigate', label: 'Investigate', hint: 'Chat and reproduce failure context', icon: 'fa-bug', mainView: 'chat' },
      { id: 'trace', label: 'Trace', hint: 'Graph-linked source evidence', icon: 'fa-diagram-project', mainView: 'knowledgeGraph' },
      { id: 'ontology', label: 'Ontology', hint: 'Runtime facts with provenance', icon: 'fa-network-wired', mainView: 'ontology' },
      { id: 'capture', label: 'Capture', hint: 'Wiki notes for regression history', icon: 'fa-book-open', mainView: 'wiki' }
    ],
    settingsSections: ['general', 'appearance', 'runtime', 'widgets', 'chat'],
    defaultDensity: 'standard',
    tourTip: 'Use Stats while exercising flows; plugin traffic is under Settings → Integrations. Pin Issues from the shell if you track defects there.',
    tourCtaPrimaryLabel: 'Open Run',
    tourCtaSecondaryLabel: 'Continue',
    defaultPinnedWidgets: {
      metricsPinned: true,
      issuesPinned: true,
      activityPinned: true,
      downloadsPinned: false
    }
  },
  builder_admin: {
    mainViews: ['chat', 'wiki', 'knowledgeGraph', 'ontology', 'codebaseLandscape', 'architectureRepository', 'train'],
    toolDrawers: ['hf', 'runtime', 'train', 'metrics'],
    defaultMainView: 'wiki',
    defaultAppMainView: 'electronDev',
    taskNav: [
      { id: 'develop', label: 'Develop', hint: 'App diagnostics and integration hub', icon: 'fa-code', mainView: 'electronDev' },
      { id: 'build', label: 'Build', hint: 'Codebase landscape and formal runs', icon: 'fa-hammer', mainView: 'codebaseLandscape' },
      { id: 'structure', label: 'Structure', hint: 'Architecture repository workflows', icon: 'fa-sitemap', mainView: 'architectureRepository' },
      { id: 'explore', label: 'Explore', hint: 'Wiki and source context', icon: 'fa-book-open', mainView: 'wiki' },
      { id: 'chat', label: 'Chat', hint: 'Assistant workspace and conversation history', icon: 'fa-comments', mainView: 'chat' },
      { id: 'trace', label: 'Trace', hint: 'Knowledge graph relationships', icon: 'fa-diagram-project', mainView: 'knowledgeGraph' },
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
  software_developer: 'Dev hub, wiki, training, models, run, stats',
  software_architect: 'Wiki, Test Repo, model footprint',
  business_analyst: 'Chat and wiki; minimal tools',
  tester: 'Chat, wiki, graph, stats, integrations settings',
  builder_admin: 'All views, all settings, diagnostics, and dev hub'
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
