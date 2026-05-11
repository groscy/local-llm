import { describe, expect, it } from 'vitest'
import {
  ADVANCED_MAIN_VIEWS,
  APP_MAIN_VIEW_COPY,
  isAdvancedMainView,
  UI_ACTION_LABELS,
  UI_FEEDBACK_VARIANTS,
  WORKSPACE_STATUS_LABELS,
  UI_ROLE_IDS,
  SETTINGS_SECTION_IDS,
  roleLayout,
  layoutDefaultMainArea,
  parseUiRole,
  parseWorkspaceDensity
} from './uiRole'

describe('uiRole role layouts', () => {
  it('accepts and parses all declared role ids', () => {
    for (const role of UI_ROLE_IDS) {
      expect(parseUiRole(role)).toBe(role)
    }
    expect(parseUiRole('unknown')).toBeNull()
  })

  it('builder_admin exposes all views and all settings', () => {
    const layout = roleLayout('builder_admin')
    expect(layout.mainViews).toEqual(
      expect.arrayContaining([
        'chat',
        'wiki',
        'releasePlanner',
        'architectureRepository',
        'codebaseLandscape',
        'train'
      ])
    )
    expect(layoutDefaultMainArea(layout)).toBe('electronDev')
    expect(layout.settingsSections).toEqual(SETTINGS_SECTION_IDS)
    expect(layout.toolDrawers).toEqual(expect.arrayContaining(['hf', 'runtime', 'train', 'metrics']))
  })

  it('deployed roles expose only role-focused settings', () => {
    const analyst = roleLayout('business_analyst')
    expect(analyst.settingsSections).toEqual(expect.arrayContaining(['general', 'appearance', 'runtime']))
    expect(analyst.settingsSections).not.toContain('maintenance')

    const tester = roleLayout('tester')
    expect(tester.settingsSections).toEqual(expect.arrayContaining(['widgets', 'chat']))
  })

  it('software_architect nav stays focused on five core tasks', () => {
    const architect = roleLayout('software_architect')
    expect(architect.taskNav).toHaveLength(4)
    expect(architect.taskNav.map((item) => item.id)).toEqual([
      'structure',
      'explore',
      'validate',
      'discuss'
    ])
    expect(layoutDefaultMainArea(architect)).toBe('architectureRepository')
  })

  it('shows release readiness only for Builder / Admin', () => {
    for (const role of UI_ROLE_IDS) {
      const hasReadiness = roleLayout(role).mainViews.includes('releasePlanner')
      if (role === 'builder_admin') {
        expect(hasReadiness).toBe(true)
      } else {
        expect(hasReadiness).toBe(false)
      }
    }
  })

  it('every app main view has presentation copy', () => {
    const dev = roleLayout('software_developer')
    const arch = roleLayout('software_architect')
    const admin = roleLayout('builder_admin')
    const allViews = new Set([
      ...dev.mainViews,
      ...arch.mainViews,
      ...admin.mainViews,
      layoutDefaultMainArea(dev),
      layoutDefaultMainArea(arch),
      layoutDefaultMainArea(admin)
    ])
    for (const view of allViews) {
      expect(APP_MAIN_VIEW_COPY[view]).toBeTruthy()
      expect(APP_MAIN_VIEW_COPY[view].title.length).toBeGreaterThan(0)
      expect(APP_MAIN_VIEW_COPY[view].subtitle.length).toBeGreaterThan(0)
    }
  })

  it('normalizes workspace density values', () => {
    expect(parseWorkspaceDensity('focused')).toBe('focused')
    expect(parseWorkspaceDensity('standard')).toBe('standard')
    expect(parseWorkspaceDensity('expanded')).toBe('expanded')
    expect(parseWorkspaceDensity('other')).toBe('standard')
    expect(parseWorkspaceDensity(null)).toBe('standard')
  })

  it('defines canonical action, state, and feedback vocabulary', () => {
    expect(UI_ACTION_LABELS.run).toBe('Run')
    expect(UI_ACTION_LABELS.metrics).toBe('Metrics')
    expect(UI_ACTION_LABELS.settings).toBe('Settings')
    expect(WORKSPACE_STATUS_LABELS).toEqual(['Ready', 'Running', 'Blocked', 'Needs input'])
    expect(UI_FEEDBACK_VARIANTS).toEqual(['info', 'success', 'warning', 'error'])
  })

  it('keeps software_developer setup CTA aligned with destination behavior', () => {
    const dev = roleLayout('software_developer')
    expect(layoutDefaultMainArea(dev)).toBe('electronDev')
    expect(dev.tourCtaPrimaryLabel).toContain('Developer hub')
    expect(dev.tourSecondaryBehavior).toBe('open_runtime_finish')
  })

  it('keeps onboarding and metrics terminology consistent across roles', () => {
    for (const role of UI_ROLE_IDS) {
      const layout = roleLayout(role)
      expect(layout.tourChecklist.footnote).toContain('Settings -> General -> First-time tips')
      expect(layout.tourTip).not.toContain('Stats')
    }
  })

  it('marks advanced surfaces explicitly for presentation-mode filtering', () => {
    for (const v of ADVANCED_MAIN_VIEWS) {
      expect(isAdvancedMainView(v)).toBe(true)
    }
    expect(isAdvancedMainView('wiki')).toBe(false)
    expect(isAdvancedMainView('train')).toBe(false)
  })
})
