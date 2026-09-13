/**
 * The `update` Remote service: RPC surface, status assembly, reconciliation,
 * and the apply flow's gates, against a real cordis Context with scripted
 * tools (runner, spawner, engine probe, facts).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import UpdateGateway, { resolveConfig } from '../src/index.ts'
import type { CommandRunner } from '../src/commands.ts'
import type { VersionFacts } from '../src/schemas.ts'

const contexts: Context[] = []
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env.DSH_HOME
})

const SOURCE_FACTS: VersionFacts = {
  version: '0.1.5-rc.2', anchor: '/checkout/apps/cli', form: 'source', gitRoot: '/checkout',
}

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-about-gateway-'))
  tempDirs.push(dir)
  process.env.DSH_HOME = dir
  return dir
}

function runner(script: Record<string, { ok: boolean, stdout?: string, stderr?: string }>): CommandRunner {
  return vi.fn(async (command: string, args: readonly string[]) => {
    const key = `${command} ${args.join(' ')}`
    const hit = script[key]
    if (hit === undefined) return { ok: false, code: 127, stdout: '', stderr: `unscripted: ${key}` }
    return { ok: hit.ok, code: hit.ok ? 0 : 1, stdout: hit.stdout ?? '', stderr: hit.stderr ?? '' }
  }) as unknown as CommandRunner
}

interface Mount {
  readonly ctx: Context
  readonly gateway: UpdateGateway
  readonly spawned: string[]
}

async function mount(
  facts: VersionFacts,
  script: Record<string, { ok: boolean, stdout?: string, stderr?: string }>,
  config: Record<string, unknown> = {},
): Promise<Mount> {
  const spawned: string[] = []
  const ctx = new Context()
  contexts.push(ctx)
  // Constructed directly (a Service registers itself on the context); running
  // the instance through ctx.plugin would treat the @Remote-decorated `apply`
  // method as the plugin's apply entry.
  const gateway = new UpdateGateway(ctx, config, {
    facts,
    runner: runner(script),
    spawner: planPath => { spawned.push(planPath) },
    engineProbe: () => Promise.resolve(false),
  })
  return { ctx, gateway, spawned }
}

/** A clean source checkout script where origin/master is one commit ahead. */
function aheadScript(over: Record<string, { ok: boolean, stdout?: string, stderr?: string }> = {}): Record<string, { ok: boolean, stdout?: string, stderr?: string }> {
  return {
    'git status --porcelain': { ok: true, stdout: '' },
    'git remote get-url origin': { ok: true, stdout: 'https://github.com/deepseek-ai/deepseek-harness.git\n' },
    'git rev-parse HEAD': { ok: true, stdout: 'aaaaaaaaaaaaaaaaaaaa\n' },
    'git rev-parse origin/master': { ok: true, stdout: 'bbbbbbbbbbbbbbbbbbbb\n' },
    ...over,
  }
}

describe('Remote surface', () => {
  it('publishes status/check/apply under the update namespace', async () => {
    const { gateway } = await mount(SOURCE_FACTS, aheadScript())
    expect(gateway.typertRemote).toMatchObject({ serviceKey: 'update', namespace: 'update' })
    expect(remoteMethods(gateway)).toEqual([
      { method: 'status', invocation: { kind: 'direct' } },
      { method: 'check', invocation: { kind: 'direct' } },
      { method: 'apply', invocation: { kind: 'direct' } },
    ])
  })
})

describe('resolveConfig', () => {
  it('defaults every field from an empty row', () => {
    const config = resolveConfig(undefined)
    expect(config.trackedRef).toBe('master')
    expect(config.originAllowlist).toContain('https://github.com/deepseek-ai/deepseek-harness.git')
    expect(config.npmPackage).toBe('@deepseek-ai/dsh')
    expect(config.npmDistTag).toBe('latest')
    expect(config.historyLimit).toBeGreaterThan(0)
  })

  it('accepts valid overrides and drops invalid ones', () => {
    const config = resolveConfig({
      trackedRef: 'develop',
      originAllowlist: ['https://example.com/harness.git', 42],
      npmDistTag: 'next',
      incomingLimit: 5,
      historyLimit: -3,
    })
    expect(config.trackedRef).toBe('develop')
    expect(config.originAllowlist).toEqual(['https://example.com/harness.git'])
    expect(config.npmDistTag).toBe('next')
    expect(config.incomingLimit).toBe(5)
    expect(config.historyLimit).toBe(30)
  })
})

describe('status', () => {
  it('assembles facts, engine, channels, and history', async () => {
    const dir = home()
    const { gateway } = await mount(SOURCE_FACTS, aheadScript())
    const status = await gateway.status()
    expect(status.dsh.version).toBe('0.1.5-rc.2')
    expect(status.dsh.form).toBe('source')
    expect(status.engine.requiredVersion).toBe('0.2.0')
    expect(status.engine.available).toBeNull()
    expect(status.channels).toEqual([
      { channel: 'source', available: true },
      { channel: 'npm', available: true },
    ])
    expect(status.history).toEqual([])
    expect(status.statusFile).toBe(join(dir, 'update-log.jsonl'))
  })

  it('marks channels unavailable for an unknown form', async () => {
    home()
    const { gateway } = await mount(
      { version: '0.0.0', anchor: '/app', form: 'unknown' }, {},
    )
    const status = await gateway.status()
    expect(status.channels).toEqual([
      { channel: 'source', available: false, note: 'no git worktree detected for this installation' },
      { channel: 'npm', available: false, note: 'install form unknown — packaged executables own their updates' },
    ])
  })
})

describe('reconciliation at mount', () => {
  it('appends verified for a pending restarted entry', async () => {
    const dir = home()
    const { appendEntry } = await import('../src/status-file.ts')
    appendEntry(dir, { at: 1, event: 'restarted', anchor: '/checkout' })
    await mount(SOURCE_FACTS, aheadScript())
    const { readEntries } = await import('../src/status-file.ts')
    const entries = readEntries(dir, 10)
    expect(entries.map(entry => entry.event)).toEqual(['restarted', 'verified'])
  })

  it('marks a torn attempt orphaned', async () => {
    const dir = home()
    const { appendEntry } = await import('../src/status-file.ts')
    appendEntry(dir, { at: 1, event: 'started', anchor: '/checkout', detail: 'supervised upgrade' })
    appendEntry(dir, { at: 2, event: 'step-ok', anchor: '/checkout', detail: 'step: git fetch origin master' })
    await mount(SOURCE_FACTS, aheadScript())
    const { readEntries } = await import('../src/status-file.ts')
    const entries = readEntries(dir, 10)
    expect(entries.at(-1)?.event).toBe('orphaned')
    expect(entries.at(-1)?.detail).toContain('step-ok')
  })
})

describe('check', () => {
  it('returns the source-channel comparison for a source form', async () => {
    home()
    const { gateway } = await mount(SOURCE_FACTS, {
      'git remote get-url origin': { ok: true, stdout: 'https://github.com/deepseek-ai/deepseek-harness.git\n' },
      'git fetch origin master': { ok: true },
      'git rev-parse HEAD': { ok: true, stdout: 'aaaaaaaaaaaaaaaaaaaa\n' },
      'git rev-parse origin/master': { ok: true, stdout: 'bbbbbbbbbbbbbbbbbbbb\n' },
      'git rev-list --count HEAD..origin/master': { ok: true, stdout: '1\n' },
      'git rev-list --count origin/master..HEAD': { ok: true, stdout: '0\n' },
      'git status --porcelain': { ok: true, stdout: '' },
      'git log --oneline --no-decorate -n 20 HEAD..origin/master': { ok: true, stdout: 'bbbbbbbbbbbb one fix\n' },
    })
    const check = await gateway.check()
    expect(check.form).toBe('source')
    expect(check.source?.behind).toBe(1)
    expect(check.source?.incoming).toEqual([{ sha: 'bbbbbbbbbbbb', subject: 'one fix' }])
  })
})

describe('apply', () => {
  it('rejects a non-source form before touching anything', async () => {
    home()
    const { gateway, spawned } = await mount(
      { version: '0.1.4', anchor: '/install', form: 'npm' }, aheadScript(),
    )
    const result = await gateway.apply()
    expect(result.accepted).toBe(false)
    expect(result.mode).toBe('rejected')
    expect(result.reason).toContain('git checkout installation')
    expect(spawned).toEqual([])
  })

  it('rejects a dirty worktree from preflight', async () => {
    home()
    const { gateway, spawned } = await mount(SOURCE_FACTS, aheadScript({
      'git status --porcelain': { ok: true, stdout: ' M a.ts\n' },
    }))
    const result = await gateway.apply()
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('dirty')
    expect(spawned).toEqual([])
  })

  it('rejects an unallowlisted origin', async () => {
    home()
    const { gateway, spawned } = await mount(SOURCE_FACTS, aheadScript({
      'git remote get-url origin': { ok: true, stdout: 'https://evil.example/harness.git\n' },
    }))
    const result = await gateway.apply()
    expect(result.reason).toContain('allowlist')
    expect(spawned).toEqual([])
  })

  it('rejects when already at the tracked head', async () => {
    home()
    const { gateway, spawned } = await mount(SOURCE_FACTS, aheadScript({
      'git rev-parse origin/master': { ok: true, stdout: 'aaaaaaaaaaaaaaaaaaaa\n' },
    }))
    const result = await gateway.apply()
    expect(result.reason).toContain('already at the tracked master head')
    expect(spawned).toEqual([])
  })

  it('rejects when another attempt is pending', async () => {
    const dir = home()
    const { gateway, spawned } = await mount(SOURCE_FACTS, aheadScript())
    // The in-flight attempt is journaled AFTER mount: boot reconciliation
    // only orphans attempts this fresh process did not witness.
    const { appendEntry } = await import('../src/status-file.ts')
    appendEntry(dir, { at: 1, event: 'started', anchor: '/checkout' })
    const result = await gateway.apply()
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('pending')
    expect(spawned).toEqual([])
  })

  it('accepts: writes the plan, journals started, spawns the supervisor', async () => {
    const dir = home()
    const { gateway, spawned } = await mount(SOURCE_FACTS, aheadScript())
    const result = await gateway.apply()
    expect(result.accepted).toBe(true)
    expect(result.mode).toBe('plugin-local')
    expect(result.fromSha).toBe('aaaaaaaaaaaaaaaaaaaa')
    expect(result.statusFile).toBe(join(dir, 'update-log.jsonl'))
    expect(spawned).toHaveLength(1)
    // The plan the supervisor received is the one on disk.
    const plan = JSON.parse(readFileSync(spawned[0] ?? '', 'utf8')) as {
      anchor: string, fromSha: string, toSha: string, steps: { label: string }[], restart: object, waitPids: number[],
    }
    expect(plan.anchor).toBe('/checkout')
    expect(plan.fromSha).toBe('aaaaaaaaaaaaaaaaaaaa')
    expect(plan.toSha).toBe('bbbbbbbbbbbbbbbbbbbb')
    expect(plan.steps).toHaveLength(4)
    expect(plan.waitPids).toEqual([process.pid])
    // The status journal carries the started entry.
    const { readEntries } = await import('../src/status-file.ts')
    const entries = readEntries(dir, 10)
    expect(entries.at(-1)?.event).toBe('started')
    expect(entries.at(-1)?.from).toBe('aaaaaaaaaaaaaaaaaaaa')
  })

  it('delegates to the launcher engine when the probe answers', async () => {
    const dir = home()
    const spawned: string[] = []
    const ctx = new Context()
    contexts.push(ctx)
    // The engine probe/apply run process.execPath with the live argv shape.
    const entry = process.argv[1] ?? 'dsh'
    const applyKey = [process.execPath, ...process.execArgv, entry, 'update', 'apply', '--json'].join(' ')
    const gateway = new UpdateGateway(ctx, {}, {
      facts: SOURCE_FACTS,
      runner: runner(aheadScript({
        [applyKey]: { ok: true, stdout: '{"accepted":true}' },
      })),
      spawner: planPath => { spawned.push(planPath) },
      engineProbe: () => Promise.resolve(true),
    })
    const result = await gateway.apply()
    expect(result.accepted).toBe(true)
    expect(result.mode).toBe('engine')
    expect(spawned).toEqual([])
    const { readEntries } = await import('../src/status-file.ts')
    expect(readEntries(dir, 10).at(-1)?.detail).toContain('launcher update engine')
  })
})
