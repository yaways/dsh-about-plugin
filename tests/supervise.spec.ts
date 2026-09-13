/** Upgrade plan construction and preflight gates. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandRunner } from '../src/commands.ts'
import { DEFAULT_CHANNEL_CONFIG } from '../src/channels.ts'
import type { VersionFacts } from '../src/schemas.ts'
import { buildUpgradePlan, preflightSource, snapshotRestart } from '../src/supervise.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

const FACTS: VersionFacts = {
  version: '0.1.5-rc.2', anchor: '/checkout/apps/cli', form: 'source', gitRoot: '/checkout',
}

function runner(script: Record<string, { ok: boolean, stdout?: string, stderr?: string }>): CommandRunner {
  return vi.fn(async (command: string, args: readonly string[]) => {
    const key = `${command} ${args.join(' ')}`
    const hit = script[key]
    if (hit === undefined) return { ok: false, code: 127, stdout: '', stderr: `unscripted: ${key}` }
    return { ok: hit.ok, code: hit.ok ? 0 : 1, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' }
  }) as unknown as CommandRunner
}

describe('snapshotRestart', () => {
  it('captures execPath, execArgv, argv tail, and cwd', () => {
    const restart = snapshotRestart()
    expect(restart.command).toBe(process.execPath)
    expect(restart.args).toEqual([...process.execArgv, ...process.argv.slice(1)])
    expect(restart.cwd).toBe(process.cwd())
  })
})

describe('buildUpgradePlan', () => {
  it('records the fixed command vocabulary and the rollback', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-about-plan-'))
    tempDirs.push(home)
    process.env.DSH_HOME = home
    const plan = buildUpgradePlan(FACTS, DEFAULT_CHANNEL_CONFIG, 'aaaa', 'bbbb')
    expect(plan.version).toBe(1)
    expect(plan.anchor).toBe('/checkout')
    expect(plan.fromSha).toBe('aaaa')
    expect(plan.toSha).toBe('bbbb')
    expect(plan.trackedRef).toBe('master')
    expect(plan.steps.map(step => step.label)).toEqual([
      'git fetch origin master',
      'git pull --ff-only',
      'pnpm install',
      'pnpm run build',
    ])
    expect(plan.steps.map(step => [step.command, ...step.args])).toEqual([
      ['git', 'fetch', 'origin', 'master'],
      ['git', 'pull', '--ff-only'],
      ['pnpm', 'install'],
      ['pnpm', 'run', 'build'],
    ])
    expect(plan.rollback[0]).toMatchObject({ command: 'git', args: ['reset', '--hard', 'aaaa'] })
    expect(plan.waitPids).toEqual([process.pid])
    expect(plan.dshHome).toBe(home)
    expect(plan.statusFile).toBe(join(home, 'update-log.jsonl'))
  })

  it('snapshots the current launcher invocation as the restart', () => {
    process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-about-plan-'))
    tempDirs.push(process.env.DSH_HOME)
    const plan = buildUpgradePlan(FACTS, DEFAULT_CHANNEL_CONFIG, 'aaaa', 'bbbb')
    expect(plan.restart).toEqual(snapshotRestart())
  })
})

describe('preflightSource', () => {
  it('rejects a missing git root', async () => {
    const reason = await preflightSource({ ...FACTS, gitRoot: undefined }, DEFAULT_CHANNEL_CONFIG, runner({}))
    expect(reason).toContain('not a git worktree')
  })

  it('rejects a dirty worktree with the first paths named', async () => {
    const run = runner({
      'git status --porcelain': { ok: true, stdout: ' M a.ts\n M b.ts\n?? c.log\n' },
    })
    const reason = await preflightSource(FACTS, DEFAULT_CHANNEL_CONFIG, run)
    expect(reason).toContain('dirty')
    expect(reason).toContain('M a.ts')
    expect(reason).toContain('3 changed paths')
  })

  it('accepts a clean worktree with an allowlisted origin', async () => {
    const run = runner({
      'git status --porcelain': { ok: true, stdout: '' },
      'git remote get-url origin': { ok: true, stdout: 'https://github.com/deepseek-ai/deepseek-harness.git\n' },
    })
    expect(await preflightSource(FACTS, DEFAULT_CHANNEL_CONFIG, run)).toBeUndefined()
  })

  it('rejects an unconfigured origin', async () => {
    const run = runner({
      'git status --porcelain': { ok: true, stdout: '' },
      'git remote get-url origin': { ok: false, stderr: 'no such remote' },
    })
    expect(await preflightSource(FACTS, DEFAULT_CHANNEL_CONFIG, run)).toContain('origin is not configured')
  })

  it('rejects an unallowlisted origin', async () => {
    const run = runner({
      'git status --porcelain': { ok: true, stdout: '' },
      'git remote get-url origin': { ok: true, stdout: 'https://evil.example/harness.git\n' },
    })
    const reason = await preflightSource(FACTS, DEFAULT_CHANNEL_CONFIG, run)
    expect(reason).toContain('not in the allowlist')
  })
})
