/**
 * Browser-level verification of the About panel against a live server.
 *
 * Loads the app in headless Chromium, walks Settings → About, and exercises
 * the panel exactly as a user does: version facts render, a check runs
 * end-to-end (the RPC round trip, not a stub), and the upgrade button stays
 * disabled while the worktree is dirty. Prints a PASS/FAIL line per check
 * and saves screenshots for manual review.
 *
 * Usage: node scripts/verify-browser.mjs <base-url-with-token> [out-dir]
 *
 * Playwright is a devDependency of the harness's web app, not of this
 * plugin: it is resolved from a sibling deepseek-harness checkout (the same
 * layout the prepare linker probes), from DSH_ABOUT_PLAYWRIGHT (a path whose
 * node_modules holds playwright), or last from the working directory.
 */
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Load playwright's chromium launcher from the first anchor that has it. */
function loadChromium() {
  const checkout = process.env.DSH_ABOUT_HARNESS_CHECKOUT
    ?? resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'deepseek-harness')
  const anchors = []
  const explicit = process.env.DSH_ABOUT_PLAYWRIGHT
  if (explicit !== undefined && explicit !== '') {
    anchors.push([`DSH_ABOUT_PLAYWRIGHT=${explicit}`, join(resolve(explicit), 'package.json')])
  }
  anchors.push([`${checkout}/apps/web`, join(checkout, 'apps/web/package.json')])
  anchors.push(['working directory', join(process.cwd(), 'package.json')])
  for (const [label, anchor] of anchors) {
    try {
      const chromium = createRequire(anchor)('playwright').chromium
      console.error(`[verify-browser] playwright from ${label}`)
      return chromium
    } catch {
      // Try the next anchor.
    }
  }
  console.error(
    '[verify-browser] playwright not found — set DSH_ABOUT_HARNESS_CHECKOUT to a harness '
    + 'checkout (its web app dev-depends on playwright), or DSH_ABOUT_PLAYWRIGHT to a path '
    + 'resolving playwright',
  )
  process.exit(2)
}

const chromium = loadChromium()

const base = process.argv[2]
if (base === undefined || base === '') {
  console.error('usage: node scripts/verify-browser.mjs <base-url-with-token> [out-dir]')
  process.exit(2)
}
const outDir = resolve(process.argv[3] ?? '/tmp/dsh-about-browser-verify')
mkdirSync(outDir, { recursive: true })

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : ` — ${detail}`}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
  })

  await page.goto(base, { waitUntil: 'domcontentloaded' })
  // The app keeps long-lived connections (RPC streams), so networkidle never
  // settles; wait for the shell instead.
  await page.getByRole('button').first().waitFor({ state: 'visible', timeout: 30_000 })
  await page.screenshot({ path: `${outDir}/01-app.png` })
  check('app loads', errors.length === 0, errors.slice(0, 2).join(' | '))

  // Dismiss any first-run dialog (internal-testing notice, API-key setup):
  // click the first ENABLED button inside it, whatever it is.
  for (let round = 0; round < 3; round += 1) {
    const dialog = page.getByRole('dialog').first()
    if (!(await dialog.isVisible().catch(() => false))) break
    const candidates = await dialog.getByRole('button').all()
    let clicked = false
    for (const candidate of candidates) {
      if (await candidate.isEnabled().catch(() => false)) {
        await candidate.click({ timeout: 5000 }).catch(() => {})
        clicked = true
        break
      }
    }
    if (!clicked) break
    await page.waitForTimeout(700)
  }

  // Open Settings: the sidebar trigger registered by ui-settings-general.
  const settingsTrigger = page.getByRole('button', { name: /settings|设置/i }).first()
  await settingsTrigger.waitFor({ state: 'visible', timeout: 20_000 })
  await settingsTrigger.click()
  await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 })
  await page.screenshot({ path: `${outDir}/02-settings.png` })
  check('settings dialog opens', true)

  // The About section nav row (zh: 关于, en: About).
  const aboutNav = page.getByRole('button', { name: /^(关于|About)$/ }).first()
  await aboutNav.waitFor({ state: 'visible', timeout: 10_000 })
  await aboutNav.click()

  // Version card facts. Wait for each (the section mounts lazily inside the
  // dialog; the shell may show its own version string elsewhere).
  const versionLocator = page.getByText('0.1.5-rc.2')
  await versionLocator.first().waitFor({ state: 'visible', timeout: 20_000 })
  const formLocator = page.getByText(/源码安装|source checkout/i)
  await formLocator.first().waitFor({ state: 'visible', timeout: 20_000 })
  check('dsh version renders', true)
  check('install form tag renders', await formLocator.first().isVisible())
  const pluginLocator = page.getByText(/dsh-about-plugin 0\.1\.0/i)
  await pluginLocator.first().waitFor({ state: 'visible', timeout: 20_000 })
  check('plugin version renders', await pluginLocator.first().isVisible())
  await page.screenshot({ path: `${outDir}/03-about.png` })

  // Run a check end-to-end through the panel's own button.
  const checkButton = page.getByRole('button', { name: /检查更新|Check for updates/i }).first()
  await checkButton.click()
  const upToDate = await page.getByText(/已是最新|Up to date/i).first().waitFor({ state: 'visible', timeout: 60_000 })
  check('check runs and reports up-to-date', upToDate !== null)
  const dirtyShown = await page.getByText(/工作树有未提交修改|Worktree has uncommitted changes/i).first().isVisible()
  check('dirty-worktree tag renders', dirtyShown)
  await page.screenshot({ path: `${outDir}/04-after-check.png` })

  // The upgrade button must stay disabled on a dirty worktree.
  const upgrade = page.getByRole('button', { name: /升级并重启|Upgrade and restart/i }).first()
  const disabled = await upgrade.isDisabled()
  check('upgrade disabled on dirty worktree', disabled)

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
  console.log(failures.length === 0
    ? `\nALL BROWSER CHECKS PASSED (screenshots in ${outDir})`
    : `\n${String(failures.length)} BROWSER CHECK(S) FAILED: ${failures.join(', ')}`)
  process.exitCode = failures.length === 0 ? 0 : 1
} finally {
  await browser.close()
}
