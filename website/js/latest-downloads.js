/**
 * Fills per-OS download links from data/latest.json (GitHub Releases asset URLs).
 * Falls back to the generic Releases page if fetch fails or files are missing.
 */
;(function () {
  const RELEASES_PAGE = 'https://github.com/localllm/local-llm-desktop/releases'
  const JSON_PATH = './data/latest.json'

  function assetUrl(repo, tag, filename) {
    const enc = encodeURIComponent(filename)
    return `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${enc}`
  }

  function setHref(id, url) {
    const el = document.getElementById(id)
    if (el) el.href = url
  }

  function setText(id, text) {
    const el = document.getElementById(id)
    if (el) {
      el.textContent = text
      el.hidden = false
    }
  }

  async function run() {
    let data
    try {
      const res = await fetch(JSON_PATH, { cache: 'no-store' })
      if (!res.ok) return
      data = await res.json()
    } catch {
      return
    }

    const { repo, tag, version, files } = data
    if (!repo || !tag || !files) return

    const vLabel = version ? `Release ${version}` : tag
    setText('download-version-label', vLabel)

    const f = files
    if (f.winSetup) setHref('dl-win-setup', assetUrl(repo, tag, f.winSetup))
    if (f.winZip) setHref('dl-win-zip', assetUrl(repo, tag, f.winZip))
    if (f.macArmDmg) setHref('dl-mac-arm-dmg', assetUrl(repo, tag, f.macArmDmg))
    if (f.macX64Dmg) setHref('dl-mac-x64-dmg', assetUrl(repo, tag, f.macX64Dmg))
    if (f.linuxAppImage) setHref('dl-linux-appimage', assetUrl(repo, tag, f.linuxAppImage))
    if (f.linuxDeb) setHref('dl-linux-deb', assetUrl(repo, tag, f.linuxDeb))
    if (f.linuxZip) setHref('dl-linux-zip', assetUrl(repo, tag, f.linuxZip))

    setHref('dl-all-releases', RELEASES_PAGE)
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run)
  } else {
    run()
  }
})()
