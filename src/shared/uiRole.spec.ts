import { describe, expect, it } from 'vitest'
import {
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
        'knowledgeGraph',
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

  it('normalizes workspace density values', () => {
    expect(parseWorkspaceDensity('focused')).toBe('focused')
    expect(parseWorkspaceDensity('standard')).toBe('standard')
    expect(parseWorkspaceDensity('expanded')).toBe('expanded')
    expect(parseWorkspaceDensity('other')).toBe('standard')
    expect(parseWorkspaceDensity(null)).toBe('standard')
  })
})
