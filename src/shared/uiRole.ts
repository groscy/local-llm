/** Bump when first-run setup tour content changes; user sees tour until version matches. */
export const SETUP_TOUR_LATEST = 1

/** Bump when welcome checklist copy changes; kept in sync with renderer onboarding. */
export const WELCOME_GUIDE_LATEST = 1

export const UI_ROLE_IDS = [
  'software_developer',
  'software_architect',
  'business_analyst',
  'tester'
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

export type MainShellView = 'chat' | 'wiki' | 'train' | 'architectureRepository'

export type ToolDrawerId = 'hf' | 'runtime' | 'train' | 'metrics'

/** Main area view id including the Dev shell (see `devShellChromeVisible`). */
export type AppMainView = MainShellView | 'electronDev'

export type RoleLayout = {
  mainViews: MainShellView[]
  toolDrawers: ToolDrawerId[]
  defaultMainView: MainShellView
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
  tourSecondaryBehavior?: 'next_step' | 'open_runtime_finish'
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
    mainViews: ['wiki', 'train'],
    toolDrawers: ['hf', 'runtime', 'metrics'],
    defaultMainView: 'wiki',
    defaultAppMainView: 'electronDev',
    hideChatMainView: true,
    tourTip:
      'Start from the Dev hub for bridge and tooling, then Wiki and Run. The in-app Chat view is hidden for this role — use your IDE plugin or switch role if you need it.',
    tourCtaPrimaryLabel: 'Open Run',
    tourCtaSecondaryLabel: 'Continue',
    defaultPinnedWidgets: {}
  },
  software_architect: {
    mainViews: ['chat', 'wiki', 'architectureRepository', 'train'],
    toolDrawers: ['hf', 'runtime'],
    defaultMainView: 'wiki',
    tourTip: 'Use Wiki and the knowledge graph to capture decisions and context; Models helps compare footprint.',
    tourCtaPrimaryLabel: 'Open Wiki',
    tourCtaSecondaryLabel: 'Open Run instead',
    tourSecondaryBehavior: 'open_runtime_finish',
    defaultPinnedWidgets: {}
  },
  business_analyst: {
    mainViews: ['chat', 'wiki'],
    toolDrawers: ['hf', 'runtime'],
    defaultMainView: 'chat',
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
    mainViews: ['chat'],
    toolDrawers: ['hf', 'runtime', 'metrics'],
    defaultMainView: 'chat',
    tourTip: 'Use Stats while exercising flows; plugin traffic is under Settings → Integrations. Pin Issues from the shell if you track defects there.',
    tourCtaPrimaryLabel: 'Open Run',
    tourCtaSecondaryLabel: 'Continue',
    defaultPinnedWidgets: {
      metricsPinned: true,
      issuesPinned: true,
      activityPinned: true,
      downloadsPinned: false
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
  tester: 'Tester / QA'
}

export const UI_ROLE_CARD_BLURBS: Record<UiRole, string> = {
  software_developer: 'Dev hub, wiki, training, models, run, stats',
  software_architect: 'Wiki, Test Repo, model footprint',
  business_analyst: 'Chat and wiki; minimal tools',
  tester: 'Chat, stats, integrations settings'
}

/** Dev rail + main view: unpackaged/forced dev UI, or Software developer role in any build. */
export function devShellChromeVisible(role: UiRole, unpackagedOrForcedDevUi: boolean): boolean {
  return unpackagedOrForcedDevUi || role === 'software_developer'
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
