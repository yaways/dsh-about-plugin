/** Installation discovery: anchor, form detection, git root walk. */

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverInstallation } from '../src/install.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** One throwaway source-checkout layout: cli package inside a git worktree. */
function sourceTree(): { root: string, cli: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-about-src-'))
  tempDirs.push(root)
  mkdirSync(join(root, '.git'), { recursive: true })
  const cli = join(root, 'apps/cli')
  mkdirSync(join(cli, 'src'), { recursive: true })
  writeFileSync(join(cli, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh-cli', version: '1.2.3' }))
  writeFileSync(join(cli, 'src/bin.ts'), 'export {}')
  return { root, cli }
}

describe('discoverInstallation', () => {
  it('detects the source form from a .git worktree above the entry', () => {
    const { root, cli } = sourceTree()
    const facts = discoverInstallation(join(cli, 'src/bin.ts'))
    expect(facts.form).toBe('source')
    expect(facts.version).toBe('1.2.3')
    // The entry is realpath-resolved (macOS tmpdirs alias /var → /private/var).
    expect(facts.gitRoot).toBe(realpathSync(root))
    expect(facts.anchor).toBe(realpathSync(cli))
  })

  it('detects the npm form without a git root', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-about-npm-'))
    tempDirs.push(root)
    const pkg = join(root, 'node_modules/@deepseek-ai/dsh')
    mkdirSync(pkg, { recursive: true })
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '0.3.1' }))
    const facts = discoverInstallation(join(pkg, 'bin/dsh.js'))
    expect(facts.form).toBe('npm')
    expect(facts.version).toBe('0.3.1')
    expect(facts.gitRoot).toBeUndefined()
  })

  it('walks up from a nested entry to the nearest package.json', () => {
    const { cli } = sourceTree()
    const nested = join(cli, 'src/some/deep')
    mkdirSync(nested, { recursive: true })
    const facts = discoverInstallation(join(nested, 'main.ts'))
    expect(facts.anchor).toBe(cli)
    expect(facts.version).toBe('1.2.3')
  })

  it('falls back to unknown facts without an entry', () => {
    // An empty string skips the parameter default (process.argv[1]).
    const facts = discoverInstallation('')
    expect(facts.form).toBe('unknown')
    expect(facts.version).toBe('0.0.0')
  })

  it('falls back to unknown when no package.json exists above the entry', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-about-bare-'))
    tempDirs.push(root)
    const facts = discoverInstallation(join(root, 'orphan.js'))
    expect(facts.form).toBe('unknown')
  })
})
