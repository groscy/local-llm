import { describe, expect, it } from 'vitest'
import { slugFromGitUrl } from './codebaseWikiPipeline'

describe('slugFromGitUrl', () => {
  it('builds deterministic safe folder stems', () => {
    expect(slugFromGitUrl('https://github.com/acme/orders-service.git')).toBe('acme-orders-service')
    expect(slugFromGitUrl('git@github.com:Acme/Platform_Core.git')).toBe('acme-platform_core')
    expect(slugFromGitUrl('https://gitlab.local/team/My Repo')).toBe('team-my-repo')
  })
})
