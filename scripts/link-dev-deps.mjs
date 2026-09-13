/**
 * Development dependency linker.
 *
 * The plugin's @deepseek-ai/* peers resolve at RUNTIME through the profile
 * module fallback ($DSH_HOME/profiles/node_modules), which every dsh launch
 * maintains. Local development — typechecking, unit tests, bundling — needs
 * the same packages resolvable from THIS checkout, so this script links them
 * from a sibling DeepSeek Harness checkout's installed module graph (the same
 * trick the profile fallback itself uses).
 *
 * The script is wired as `prepare` and is a graceful no-op when no harness
 * checkout is found: published installs never need it (peers come from the
 * installation), and git installs without a sibling checkout simply skip it.
 * Point DSH_ABOUT_HARNESS_CHECKOUT at the checkout to use when the default
 * sibling layout does not hold.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Candidate harness checkouts, first existing wins. */
function harnessCheckout() {
  const fromEnv = process.env.DSH_ABOUT_HARNESS_CHECKOUT
  if (fromEnv !== undefined && fromEnv !== '') {
    return existsSync(join(fromEnv, 'apps/cli/package.json')) ? resolve(fromEnv) : undefined
  }
  const sibling = resolve(repoRoot, '..', 'deepseek-harness')
  return existsSync(join(sibling, 'apps/cli/package.json')) ? sibling : undefined
}

/** Packages the plugin needs resolvable for development (build + tests). */
const PACKAGES = [
  // cordis and its loader resolve from the CLI app's manifest (vendor links).
  { name: '@deepseek-ai/cordis', anchor: 'apps/cli/package.json' },
  { name: '@deepseek-ai/cordis-plugin-loader', anchor: 'apps/cli/package.json' },
  // The Typert protocol is a workspace package; the API gateway depends on it
  // directly, so its manifest resolves to the workspace source (0.1.5-rc.2),
  // while the CLI only reaches it transitively through stale store copies.
  { name: '@deepseek-ai/dsh-typert-protocol', anchor: 'packages/api/gateway/package.json' },
]

const checkout = harnessCheckout()
if (checkout === undefined) {
  console.log(
    '[dsh-about-plugin] no sibling deepseek-harness checkout found — skipping dev dependency links; '
    + 'set DSH_ABOUT_HARNESS_CHECKOUT to develop against a checkout',
  )
  process.exit(0)
}

for (const { name, anchor: relativeAnchor } of PACKAGES) {
  const anchor = join(checkout, relativeAnchor)
  const requireFromCli = createRequire(anchor)
  let target
  try {
    target = dirname(requireFromCli.resolve(`${name}/package.json`))
  } catch (error) {
    console.warn(`[dsh-about-plugin] could not resolve ${name} from ${anchor}: ${String(error)}`)
    continue
  }
  const scope = join(repoRoot, 'node_modules', dirname(name))
  const link = join(repoRoot, 'node_modules', name)
  mkdirSync(scope, { recursive: true })
  try {
    if (readlinkSync(link) === target) continue
  } catch {
    // No link yet (or a real directory managed by pnpm — replaced below only
    // when it is one of ours; pnpm-managed packages never collide with these
    // names because they are absent from the dependency graph).
  }
  try {
    rmSync(link, { recursive: true, force: true })
  } catch {
    // A missing link is the normal first-run case.
  }
  symlinkSync(target, link)
  console.log(`[dsh-about-plugin] linked ${name} -> ${target}`)
}
