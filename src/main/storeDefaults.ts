import type Store from 'electron-store'
import { defaultIdeJourneyChecklist, mergeIdeJourneyChecklist } from '@shared/ideJourney'
import {
  DEFAULT_UI_ROLE,
  parseUiRole,
  SETUP_TOUR_LATEST,
  WELCOME_GUIDE_LATEST
} from '@shared/uiRole'
import { DEFAULT_TYPOGRAPHY_COMFORT, parseTypographyComfort } from '@shared/typographyComfort'
import {
  DEFAULT_TYPOGRAPHY_FONT_FAMILY,
  DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM,
  DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR,
  DEFAULT_TYPOGRAPHY_WORD_SPACING_EM,
  parseTypographyFontFamily,
  parseTypographyLetterSpacingExtraEm,
  parseTypographyLineHeightFactor,
  parseTypographyWordSpacingEm
} from '@shared/typographyTune'
import { CODEBASE_FORMAL_STORE_KEY, emptyCodebaseFormalBundle } from '@shared/codebaseRegistry'

/** Default keys written on first launch and after “factory reset”. */
export const ELECTRON_STORE_DEFAULTS: Record<string, unknown> = {
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  llamaPort: 8080,
  /** Passed to llama-server `-c` (prompt + generation must fit; long chat / RAG needs more). */
  llamaContextTokens: 32_768,
  metricsPinned: false,
  metricsRefreshMs: 3000,
  downloadsPinned: false,
  activityPinned: false,
  issuesPinned: false,
  pinnedWidgetsSide: 'right',
  /** When true, the pinned widget rail shows only a slim strip until expanded. */
  pinnedWidgetsBarCollapsed: true,
  pinnedWidgetsWidthPx: 308,
  pinnedWidgetsHeightPx: 360,
  /** Relative flex weights for metrics / downloads / activity when multiple pinned widgets are stacked. */
  pinnedWidgetWeights: { metrics: 1, downloads: 1, activity: 1, issues: 1 },
  colorScheme: 'violet',
  /** Text scale & rhythm; see `@shared/typographyComfort` and `data-typography-comfort` in styles. */
  typographyComfort: 'balanced',
  typographyFontFamily: DEFAULT_TYPOGRAPHY_FONT_FAMILY,
  /** Multiplier on preset line-heights (body, chat bubbles, composer). */
  typographyLineHeightFactor: DEFAULT_TYPOGRAPHY_LINE_HEIGHT_FACTOR,
  /** Added to preset letter-spacing on the body (em). */
  typographyLetterSpacingExtraEm: DEFAULT_TYPOGRAPHY_LETTER_SPACING_EXTRA_EM,
  /** Word spacing on the body (em); 0 means CSS `normal`. */
  typographyWordSpacingEm: DEFAULT_TYPOGRAPHY_WORD_SPACING_EM,
  /** Upper bound on assistant completion length (Ollama `num_predict`; llama.cpp default unless `llamaChatMaxTokens` is set). */
  chatMaxTokens: 4096,
  /** Max prior user+assistant messages included in the API history (newest retained). */
  chatHistoryMaxMessages: 80,
  /** When true and a user message matched prompt domains with a non-empty system suffix, append that text to the system message (bounded on the server). */
  chatDomainEnhancement: false,
  /** llama.cpp: ask the model to cite RAG snippet numbers [1], [2]; UI may warn if citations are missing. */
  llamaRagGrounding: false,
  /** Build and use runtime ontology context in prompts. */
  ontologyEnabled: true,
  /** Upper bound of facts injected per request from runtime ontology retrieval. */
  ontologyMaxTriples: 40,
  /** Approx prompt-token budget for ontology context injections. */
  ontologyContextTokens: 512,
  /** llama-server `/v1/chat/completions` sampling (OpenAI-style). */
  llamaTemperature: 0.8,
  llamaTopP: 0.95,
  llamaFrequencyPenalty: 0,
  llamaPresencePenalty: 0,
  /** After each assistant reply, run a brief second pass to extract bullet notes into the knowledge base / wiki. */
  wikiAutoExtract: true,
  /** Tidy assistant Markdown (spacing, section breaks, quick outline) before saving and displaying. */
  chatResponsePostProcess: true,
  /** “Learn everything about …” runs multi-step local research and ingests one wiki article. */
  deepLearnEnabled: true,
  /** Max refinement rounds per deep-learn run (each round is one model completion). */
  deepLearnMaxRounds: 5,
  /** Max bytes downloaded per approved URL during deep-learn fetch. */
  deepLearnMaxFetchBytes: 1_500_000,
  /** Localhost HTTP API for IDE plugins (127.0.0.1 only). */
  integrationListenEnabled: false,
  integrationPort: 17373,
  integrationToken: '',
  /** After a formal verification run completes, optionally summarize logs with the local model (advisory text only). */
  formalVerificationInterpretWithLlm: false,
  /** When interpreting, include KB snippets and a bounded repo scan in the model prompt (opt-in; may contain sensitive titles). */
  formalVerificationInterpretIncludeKb: false,
  /** User-checked steps for the IntelliJ plugin journey (shown in the Dev panel when unpackaged). */
  ideJourneyChecklist: {
    backendReady: false,
    pluginInstalled: false,
    intellijConfigured: false,
    firstIdeChat: false
  },
  ideJourneyAutoChecklist: false,
  agenticWorkersEnabled: false,
  /** Self-hosted Ollama only (second machine you run); not third-party LLM APIs */
  agentRemoteOllamaUrl: '',
  /** Workspace role for simplified nav (see `@shared/uiRole`). */
  uiRole: DEFAULT_UI_ROLE,
  /** Workspace visual density (focused / standard / expanded). */
  workspaceDensity: 'standard',
  /** Codebases, formal tool profiles, and verification run history (see `@shared/codebaseRegistry`). */
  [CODEBASE_FORMAL_STORE_KEY]: emptyCodebaseFormalBundle()
}

export function resetElectronStoreToFactory(store: Store<Record<string, unknown>>): void {
  store.clear()
  for (const [k, v] of Object.entries(ELECTRON_STORE_DEFAULTS)) {
    store.set(k, v)
  }
}

/**
 * Legacy store cleanup and defaults. Call when the app starts.
 */
export function migrateCodebaseFormalStore(store: Store<Record<string, unknown>>): void {
  if (!store.has(CODEBASE_FORMAL_STORE_KEY)) {
    store.set(CODEBASE_FORMAL_STORE_KEY, emptyCodebaseFormalBundle())
  }
}

export function migrateChatProfileSettings(store: Store<Record<string, unknown>>): void {
  migrateCodebaseFormalStore(store)
  if (store.has('chatLlamaMinimalSystem')) {
    store.delete('chatLlamaMinimalSystem')
  }
  if (store.has('chatModelProfileInReplies')) {
    store.delete('chatModelProfileInReplies')
  }
  if (typeof store.get('chatDomainEnhancement') !== 'boolean') {
    store.set('chatDomainEnhancement', false)
  }
  if (!store.has('ideJourneyChecklist') || typeof store.get('ideJourneyChecklist') !== 'object') {
    store.set('ideJourneyChecklist', defaultIdeJourneyChecklist())
  } else {
    store.set(
      'ideJourneyChecklist',
      mergeIdeJourneyChecklist(store.get('ideJourneyChecklist'), {})
    )
  }
  if (typeof store.get('ideJourneyAutoChecklist') !== 'boolean') {
    store.set('ideJourneyAutoChecklist', false)
  }
  if (typeof store.get('deepLearnEnabled') !== 'boolean') {
    store.set('deepLearnEnabled', true)
  }
  if (typeof store.get('deepLearnMaxRounds') !== 'number' || !Number.isFinite(store.get('deepLearnMaxRounds'))) {
    store.set('deepLearnMaxRounds', 5)
  } else {
    const n = Math.floor(Number(store.get('deepLearnMaxRounds')))
    store.set('deepLearnMaxRounds', Math.min(24, Math.max(1, n)))
  }
  if (typeof store.get('deepLearnMaxFetchBytes') !== 'number' || !Number.isFinite(store.get('deepLearnMaxFetchBytes'))) {
    store.set('deepLearnMaxFetchBytes', 1_500_000)
  } else {
    const b = Math.floor(Number(store.get('deepLearnMaxFetchBytes')))
    store.set('deepLearnMaxFetchBytes', Math.min(8_000_000, Math.max(4096, b)))
  }
  if (typeof store.get('chatResponsePostProcess') !== 'boolean') {
    store.set('chatResponsePostProcess', true)
  }
  if (typeof store.get('ontologyEnabled') !== 'boolean') {
    store.set('ontologyEnabled', true)
  }
  if (typeof store.get('ontologyMaxTriples') !== 'number' || !Number.isFinite(store.get('ontologyMaxTriples'))) {
    store.set('ontologyMaxTriples', 40)
  } else {
    const n = Math.floor(Number(store.get('ontologyMaxTriples')))
    store.set('ontologyMaxTriples', Math.min(200, Math.max(5, n)))
  }
  if (
    typeof store.get('ontologyContextTokens') !== 'number' ||
    !Number.isFinite(store.get('ontologyContextTokens'))
  ) {
    store.set('ontologyContextTokens', 512)
  } else {
    const n = Math.floor(Number(store.get('ontologyContextTokens')))
    store.set('ontologyContextTokens', Math.min(3000, Math.max(64, n)))
  }
  if (typeof store.get('formalVerificationInterpretWithLlm') !== 'boolean') {
    store.set('formalVerificationInterpretWithLlm', false)
  }
  if (typeof store.get('formalVerificationInterpretIncludeKb') !== 'boolean') {
    store.set('formalVerificationInterpretIncludeKb', false)
  }
  if (!store.has('typographyComfort')) {
    store.set('typographyComfort', DEFAULT_TYPOGRAPHY_COMFORT)
  } else {
    const raw = store.get('typographyComfort')
    const next = parseTypographyComfort(raw)
    if (raw !== next) store.set('typographyComfort', next)
  }
  const tuneKeys: Array<[string, unknown]> = [
    ['typographyFontFamily', parseTypographyFontFamily(store.get('typographyFontFamily'))],
    ['typographyLineHeightFactor', parseTypographyLineHeightFactor(store.get('typographyLineHeightFactor'))],
    ['typographyLetterSpacingExtraEm', parseTypographyLetterSpacingExtraEm(store.get('typographyLetterSpacingExtraEm'))],
    ['typographyWordSpacingEm', parseTypographyWordSpacingEm(store.get('typographyWordSpacingEm'))]
  ]
  for (const [k, v] of tuneKeys) {
    if (!store.has(k)) store.set(k, v)
    else if (store.get(k) !== v) store.set(k, v)
  }
}

/**
 * `setupTourVersion` is intentionally not in `ELECTRON_STORE_DEFAULTS` so upgrades without the key
 * can be distinguished: existing users who already finished the legacy welcome skip the tour.
 */
export function migrateRoleSetupIfNeeded(store: Store<Record<string, unknown>>): void {
  const wvRaw = store.get('welcomeGuideVersion')
  const wv = typeof wvRaw === 'number' ? wvRaw : 0

  if (!store.has('setupTourVersion')) {
    if (wv >= WELCOME_GUIDE_LATEST) {
      store.set('setupTourVersion', SETUP_TOUR_LATEST)
    } else {
      store.set('setupTourVersion', 0)
    }
  }

  const roleRaw = store.get('uiRole')
  if (!parseUiRole(roleRaw)) {
    store.set('uiRole', DEFAULT_UI_ROLE)
  }
  const densityRaw = store.get('workspaceDensity')
  if (densityRaw !== 'focused' && densityRaw !== 'standard' && densityRaw !== 'expanded') {
    store.set('workspaceDensity', 'standard')
  }
}
