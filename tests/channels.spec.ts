/** Channel probing with a scripted command runner. */

import { describe, expect, it, vi } from 'vitest'
import type { CommandRunner } from '../src/commands.ts'
import {
  DEFAULT_CHANNEL_CONFIG, checkNpmChannel, checkSourceChannel, originAllowed, runCheck,
} from '../src/channels.ts'
import type { VersionFacts } from '../src/schemas.ts'

const SOURCE_FACTS: VersionFacts = {
  version: '0.1.5-rc.2', anchor: '/checkout/apps/cli', form: 'source', gitRoot: '/checkout',
}

const NPM_FACTS: VersionFacts = {
  version: '0.1.4', anchor: '/install/node_modules/@deepseek-ai/dsh', form: 'npm',
}

/** Build a runner answering scripted (command, args) pairs; unscripted calls fail. */
function runner(script: Record<string, { ok: boolean, stdout?: string, stderr?: string }>): CommandRunner {
  return vi.fn(async (command: string, args: readonly string[]) => {
    const key = `${command} ${args.join(' ')}`
    const hit = script[key]
    if (hit === undefined) {
      return { ok: false, code: 127, stdout: '', stderr: `unscripted: ${key}` }
    }
    return { ok: hit.ok, code: hit.ok ? 0 : 1, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' }
  }) as unknown as CommandRunner
}

/** A clean, up-to-date source checkout's script. */
function cleanSourceScript(over: Record<string, { ok: boolean, stdout?: string, stderr?: string }> = {}): Record<string, { ok: boolean, stdout?: string, stderr?: string }> {
  return {
    'git remote get-url origin': { ok: true, stdout: 'https://github.com/deepseek-ai/deepseek-harness.git\n' },
    'git fetch origin master': { ok: true },
    'git rev-parse HEAD': { ok: true, stdout: 'aaaaaaaaaaaaaaaaaaaa\n' },
    'git rev-parse origin/master': { ok: true, stdout: 'bbbbbbbbbbbbbbbbbbbb\n' },
    'git rev-list --count HEAD..origin/master': { ok: true, stdout: '2\n' },
    'git rev-list --count origin/master..HEAD': { ok: true, stdout: '0\n' },
    'git status --porcelain': { ok: true, stdout: '' },
    'git log --oneline --no-decorate -n 20 HEAD..origin/master': {
      ok: true,
      stdout: 'bbbbbbbbbbbb second commit\naaaaaaaaaaaa first commit\n',
    },
    ...over,
  }
}

describe('originAllowed', () => {
  it('accepts every allowlisted spelling, normalized', () => {
    const allowlist = ['https://github.com/deepseek-ai/deepseek-harness.git']
    expect(originAllowed(allowlist, 'https://github.com/deepseek-ai/deepseek-harness.git')).toBe(true)
    expect(originAllowed(allowlist, 'https://github.com/deepseek-ai/deepseek-harness')).toBe(true)
    expect(originAllowed(allowlist, 'https://github.com/deepseek-ai/deepseek-harness/')).toBe(true)
  })

  it('rejects other origins', () => {
    const allowlist = ['https://github.com/deepseek-ai/deepseek-harness.git']
    expect(originAllowed(allowlist, 'https://evil.example/deepseek-harness.git')).toBe(false)
    expect(originAllowed(allowlist, 'git@evil.example:deepseek-ai/deepseek-harness.git')).toBe(false)
  })
})

describe('checkSourceChannel', () => {
  it('reports behind/ahead/dirty and the incoming changelog', async () => {
    const script = cleanSourceScript({
      'git status --porcelain': { ok: true, stdout: ' M packages/x/src/a.ts\n?? notes.md\n' },
    })
    const check = await checkSourceChannel(SOURCE_FACTS, DEFAULT_CHANNEL_CONFIG, runner(script), true)
    expect(check.error).toBeUndefined()
    expect(check.currentSha).toBe('aaaaaaaaaaaaaaaaaaaa')
    expect(check.targetSha).toBe('bbbbbbbbbbbbbbbbbbbb')
    expect(check.behind).toBe(2)
    expect(check.ahead).toBe(0)
    expect(check.upToDate).toBe(false)
    expect(check.dirty).toBe(true)
    expect(check.dirtyFiles).toEqual(['M packages/x/src/a.ts', '?? notes.md'])
    expect(check.fetched).toBe(true)
    expect(check.incoming).toEqual([
      { sha: 'bbbbbbbbbbbb', subject: 'second commit' },
      { sha: 'aaaaaaaaaaaa', subject: 'first commit' },
    ])
  })

  it('marks up-to-date when behind is zero', async () => {
    const script = cleanSourceScript({
      'git rev-parse origin/master': { ok: true, stdout: 'aaaaaaaaaaaaaaaaaaaa\n' },
      'git rev-list --count HEAD..origin/master': { ok: true, stdout: '0\n' },
    })
    const check = await checkSourceChannel(SOURCE_FACTS, DEFAULT_CHANNEL_CONFIG, runner(script), true)
    expect(check.upToDate).toBe(true)
    expect(check.incoming).toEqual([])
  })

  it('refuses to fetch a non-allowlisted origin', async () => {
    const script = cleanSourceScript({
      'git remote get-url origin': { ok: true, stdout: 'https://evil.example/harness.git\n' },
    })
    const check = await checkSourceChannel(SOURCE_FACTS, DEFAULT_CHANNEL_CONFIG, runner(script), true)
    expect(check.error).toContain('allowlist')
    expect(check.fetched).toBe(false)
  })

  it('reports a missing git root without touching git', async () => {
    const run = vi.fn() as unknown as CommandRunner
    const check = await checkSourceChannel(
      { ...SOURCE_FACTS, gitRoot: undefined }, DEFAULT_CHANNEL_CONFIG, run, true,
    )
    expect(check.error).toContain('no git worktree')
    expect(run).not.toHaveBeenCalled()
  })

  it('surfaces fetch failures', async () => {
    const script = cleanSourceScript({
      'git fetch origin master': { ok: false, stderr: 'network down' },
    })
    const check = await checkSourceChannel(SOURCE_FACTS, DEFAULT_CHANNEL_CONFIG, runner(script), true)
    expect(check.error).toContain('git fetch failed')
    expect(check.error).toContain('network down')
  })

  it('reads local refs only when fetch is false', async () => {
    const script = cleanSourceScript()
    delete (script as Record<string, unknown>)['git fetch origin master']
    const check = await checkSourceChannel(SOURCE_FACTS, DEFAULT_CHANNEL_CONFIG, runner(script), false)
    expect(check.fetched).toBe(false)
    expect(check.error).toBeUndefined()
  })
})

describe('checkNpmChannel', () => {
  it('compares the installed version against the dist-tag', async () => {
    const run = runner({
      'npm view @deepseek-ai/dsh dist-tags --json': {
        ok: true, stdout: JSON.stringify({ latest: '0.1.4', next: '0.2.0-rc.1' }),
      },
    })
    const check = await checkNpmChannel(NPM_FACTS, DEFAULT_CHANNEL_CONFIG, run)
    expect(check.error).toBeUndefined()
    expect(check.installed).toBe('0.1.4')
    expect(check.latest).toBe('0.1.4')
    expect(check.upToDate).toBe(true)
  })

  it('flags an outdated install', async () => {
    const run = runner({
      'npm view @deepseek-ai/dsh dist-tags --json': {
        ok: true, stdout: JSON.stringify({ latest: '0.2.0' }),
      },
    })
    const check = await checkNpmChannel(NPM_FACTS, DEFAULT_CHANNEL_CONFIG, run)
    expect(check.upToDate).toBe(false)
    expect(check.latest).toBe('0.2.0')
  })

  it('surfaces registry failures', async () => {
    const run = runner({
      'npm view @deepseek-ai/dsh dist-tags --json': { ok: false, stderr: 'E404' },
    })
    const check = await checkNpmChannel(NPM_FACTS, DEFAULT_CHANNEL_CONFIG, run)
    expect(check.error).toContain('E404')
  })
})

describe('runCheck', () => {
  it('routes the source form to the source channel only', async () => {
    const script = cleanSourceScript()
    const run = runner(script)
    const check = await runCheck(SOURCE_FACTS, DEFAULT_CHANNEL_CONFIG, run, true)
    expect(check.form).toBe('source')
    expect(check.source).toBeDefined()
    expect(check.npm).toBeUndefined()
    expect(check.version).toBe(SOURCE_FACTS.version)
  })

  it('routes the npm form to the registry channel only', async () => {
    const run = runner({
      'npm view @deepseek-ai/dsh dist-tags --json': { ok: true, stdout: JSON.stringify({ latest: '0.1.4' }) },
    })
    const check = await runCheck(NPM_FACTS, DEFAULT_CHANNEL_CONFIG, run, false)
    expect(check.npm).toBeDefined()
    expect(check.source).toBeUndefined()
  })

  it('answers nothing for an unknown form', async () => {
    const run = vi.fn() as unknown as CommandRunner
    const check = await runCheck(
      { version: '0.0.0', anchor: '/', form: 'unknown' }, DEFAULT_CHANNEL_CONFIG, run, false,
    )
    expect(check.source).toBeUndefined()
    expect(check.npm).toBeUndefined()
    expect(run).not.toHaveBeenCalled()
  })
})
