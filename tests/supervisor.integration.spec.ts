/**
 * Supervisor integration: run the BUILT lib/supervisor.js as a real detached
 * process against a plan whose steps are no-ops, and assert the full journal
 * sequence — wait, steps, restart — lands in the status file. This exercises
 * the artifact exactly as the apply flow spawns it (the one file that runs
 * while the tree is being rewritten, so it gets its own end-to-end check).
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import type { UpgradePlan } from '../src/supervise.ts'

const supervisorEntry = fileURLToPath(new URL('../lib/supervisor.js', import.meta.url))
const tempDirs: string[] = []

afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Wait until the status file holds `expected` entries, or fail. */
async function waitForEntries(path: string, expected: number, timeoutMs = 15_000): Promise<{ at: number, event: string, detail?: string }[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (existsSync(path)) {
      const entries = readFileSync(path, 'utf8').split('\n')
        .filter(line => line.trim() !== '')
        .map(line => JSON.parse(line) as { at: number, event: string, detail?: string })
      if (entries.length >= expected) return entries
    }
    if (Date.now() >= deadline) throw new Error(`supervisor journal stalled (${existsSync(path) ? readFileSync(path, 'utf8') : 'no file'})`)
    await delay(150)
  }
}

/** Wait until a path exists (the detached restart child may still be writing). */
async function waitForFile(path: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`supervisor restart marker never appeared: ${path}`)
    await delay(150)
  }
}

describe('supervisor (built artifact)', () => {
  it('waits for the recorded pid, runs the steps, restarts, and journals it all', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-about-sup-'))
    const anchor = mkdtempSync(join(tmpdir(), 'dsh-about-sup-anchor-'))
    tempDirs.push(home, anchor)
    const statusFile = join(home, 'update-log.jsonl')
    const planPath = join(home, 'update-plan.json')

    // A marker the "restart" writes, proving the recorded restart command ran.
    const marker = join(home, 'restarted.marker')

    // A child the supervisor must out-wait: it exits 300ms after the plan is
    // written, so a supervisor that does NOT wait would race ahead of it.
    let blockerExitAt: number | undefined
    const blocker = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { stdio: 'ignore' })
    blocker.on('exit', () => { blockerExitAt = Date.now() })
    const blockerPid = blocker.pid
    expect(blockerPid).toBeDefined()

    const plan: UpgradePlan = {
      version: 1,
      anchor,
      fromSha: 'aaaaaaaaaaaaaaaaaaaa',
      toSha: 'bbbbbbbbbbbbbbbbbbbb',
      trackedRef: 'master',
      steps: [
        { label: 'noop one', command: process.execPath, args: ['-e', '0'] },
        { label: 'noop two (writes nothing)', command: process.execPath, args: ['-e', '0'] },
      ],
      rollback: [
        { label: 'rollback noop', command: process.execPath, args: ['-e', '0'] },
      ],
      restart: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`], cwd: home },
      waitPids: [blockerPid as number],
      waitTimeoutMs: 10_000,
      stepTimeoutMs: 10_000,
      dshHome: home,
      statusFile,
      startedAt: Date.now(),
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(planPath, `${JSON.stringify(plan, undefined, 2)}\n`, 'utf8')

    const child = spawn(process.execPath, [supervisorEntry, planPath], { stdio: 'ignore', detached: false })
    const deadlineGuard = Date.now() + 10_000
    const code = await new Promise<number | null>(resolve => child.on('close', code => resolve(code)))
    expect(code).toBe(0)

    // Journal: quiet note first, then one row per step, then restarted.
    const entries = await waitForEntries(statusFile, 4)
    expect(entries.map(entry => entry.event)).toEqual(['step-ok', 'step-ok', 'step-ok', 'restarted'])
    expect(entries[0]?.detail).toContain('tree quiet')
    expect(entries[1]?.detail).toContain('step: noop one')
    expect(entries[3]?.detail).toContain('aaaaaaaaaaaa → bbbbbbbbbbbb')
    // The recorded restart command ran and left its marker (detached: wait).
    await waitForFile(marker)
    // The quiet note landed only after the blocker exited: the supervisor
    // really waited for the recorded pid instead of racing ahead.
    for (; blockerExitAt === undefined;) {
      if (Date.now() > deadlineGuard) throw new Error('blocker never exited')
      await delay(100)
    }
    expect(entries[0]?.at).toBeGreaterThanOrEqual(blockerExitAt)
  }, 30_000)

  it('journals a failure without steps when the live pid never exits', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-about-sup2-'))
    tempDirs.push(home)
    const statusFile = join(home, 'update-log.jsonl')
    const planPath = join(home, 'update-plan.json')
    const plan: UpgradePlan = {
      version: 1,
      anchor: home,
      fromSha: 'aaaa',
      toSha: 'bbbb',
      trackedRef: 'master',
      steps: [{ label: 'never runs', command: process.execPath, args: ['-e', '0'] }],
      rollback: [],
      restart: { command: process.execPath, args: ['-e', '0'], cwd: home },
      // This process (vitest) stays alive, and the wait bound is short.
      waitPids: [process.pid],
      waitTimeoutMs: 400,
      stepTimeoutMs: 5_000,
      dshHome: home,
      statusFile,
      startedAt: Date.now(),
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(planPath, `${JSON.stringify(plan, undefined, 2)}\n`, 'utf8')
    const child = spawn(process.execPath, [supervisorEntry, planPath], { stdio: 'ignore' })
    const code = await new Promise<number | null>(resolve => child.on('close', code => resolve(code)))
    expect(code).toBe(1)
    const entries = await waitForEntries(statusFile, 1)
    expect(entries[0]?.event).toBe('failed')
    expect(entries[0]?.detail).toContain('did not exit')
  }, 30_000)

  it('rolls back and journals when a step fails', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-about-sup3-'))
    const anchor = mkdtempSync(join(tmpdir(), 'dsh-about-sup3-anchor-'))
    tempDirs.push(home, anchor)
    const statusFile = join(home, 'update-log.jsonl')
    const marker = join(home, 'rollback.marker')
    const plan: UpgradePlan = {
      version: 1,
      anchor,
      fromSha: 'aaaaaaaaaaaaaaaaaaaa',
      toSha: 'bbbbbbbbbbbbbbbbbbbb',
      trackedRef: 'master',
      steps: [
        { label: 'failing step', command: process.execPath, args: ['-e', 'process.exit(3)'] },
      ],
      rollback: [
        { label: 'rollback noop', command: process.execPath, args: ['-e', '0'] },
      ],
      restart: { command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`], cwd: home },
      waitPids: [],
      waitTimeoutMs: 5_000,
      stepTimeoutMs: 5_000,
      dshHome: home,
      statusFile,
      startedAt: Date.now(),
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(home, 'update-plan.json'), `${JSON.stringify(plan, undefined, 2)}\n`, 'utf8')
    const child = spawn(process.execPath, [supervisorEntry, join(home, 'update-plan.json')], { stdio: 'ignore' })
    const code = await new Promise<number | null>(resolve => child.on('close', code => resolve(code)))
    expect(code).toBe(0)
    const entries = await waitForEntries(statusFile, 5)
    expect(entries.map(entry => entry.event)).toEqual([
      'step-ok', 'step-failed', 'step-failed', 'step-ok', 'rolled-back',
    ])
    expect(entries[1]?.detail).toContain('failing step')
    expect(entries[4]?.detail).toContain('restored aaaaaaaaaaaa')
    await waitForFile(marker)
  }, 30_000)

  it('refuses an unsupported plan version', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-about-sup4-'))
    tempDirs.push(home)
    const planPath = join(home, 'update-plan.json')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(planPath, JSON.stringify({ version: 99, ...({} as object) }), 'utf8')
    const child = spawn(process.execPath, [supervisorEntry, planPath], { stdio: 'ignore' })
    const code = await new Promise<number | null>(resolve => child.on('close', code => resolve(code)))
    expect(code).toBe(2)
  })
})
