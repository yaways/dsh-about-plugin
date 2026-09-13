/**
 * Host side of the supervised upgrade: plan construction and the detached
 * supervisor spawn.
 *
 * The timing rule that decides everything: the source tree and `node_modules`
 * are never mutated under a live process. `apply` therefore (1) snapshots the
 * exact launcher invocation to restart, (2) writes a plan file, (3) spawns a
 * detached supervisor that waits for the triggering pid to exit before it
 * touches anything, and only then (4) requests this surface's own graceful
 * exit through `ctx.appExit`. Every command the supervisor runs comes from
 * this fixed, recorded vocabulary — git fetch/pull/reset, pnpm install, the
 * build script, and the recorded launcher — never from remote content.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CommandRunner } from './commands.ts'
import { originAllowed, type ChannelConfig } from './channels.ts'
import type { VersionFacts } from './schemas.ts'
import { statusFilePath } from './status-file.ts'
import { resolveDshHome } from './version.ts'

/** Plan file name inside the DSH home. */
export const PLAN_FILE_NAME = 'update-plan.json'

/** One recorded command in the sequence. */
export interface PlanStep {
  readonly label: string
  readonly command: string
  readonly args: readonly string[]
}

/** The snapshot of the launcher invocation to restart. */
export interface PlanRestart {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

/** The serialized upgrade plan the detached supervisor consumes. */
export interface UpgradePlan {
  readonly version: 1
  /** Git worktree root; every step's cwd. */
  readonly anchor: string
  /** Commit SHA recorded before the upgrade. */
  readonly fromSha: string
  /** Commit SHA the tracked remote ref resolved to. */
  readonly toSha: string
  /** Tracked ref name, for the recorded fetch. */
  readonly trackedRef: string
  /** Steps between quiet tree and restart. */
  readonly steps: readonly PlanStep[]
  /** Steps that restore the recorded SHA when a step fails. */
  readonly rollback: readonly PlanStep[]
  /** The launcher invocation to restart. */
  readonly restart: PlanRestart
  /** Pids the supervisor waits for before touching the tree. */
  readonly waitPids: readonly number[]
  /** Bound on the wait, in milliseconds. */
  readonly waitTimeoutMs: number
  /** Per-step bound, in milliseconds. */
  readonly stepTimeoutMs: number
  /** DSH home the status file lives under. */
  readonly dshHome: string
  /** Absolute status-file path. */
  readonly statusFile: string
  readonly startedAt: number
}

/** Absolute plan-file path for one home. */
export function planFilePath(home: string = resolveDshHome()): string {
  return join(home, PLAN_FILE_NAME)
}

/** Snapshot the current process's launcher invocation. */
export function snapshotRestart(): PlanRestart {
  return {
    command: process.execPath,
    // execArgv (e.g. tsx's --import) must ride along: a source-tree launch
    // without it cannot execute TypeScript entries.
    args: [...process.execArgv, ...process.argv.slice(1)],
    cwd: process.cwd(),
  }
}

/**
 * Build the upgrade plan for a source installation.
 *
 * The command vocabulary is fixed: fetch the tracked ref, fast-forward pull,
 * install, build. Rollback restores the recorded SHA, reinstalls, rebuilds.
 * @param facts - discovered installation facts (must be the source form).
 * @param config - channel configuration.
 * @param fromSha - recorded pre-upgrade commit.
 * @param toSha - target commit the remote ref resolved to.
 */
export function buildUpgradePlan(
  facts: VersionFacts,
  config: ChannelConfig,
  fromSha: string,
  toSha: string,
): UpgradePlan {
  const pnpmInstall: PlanStep = { label: 'pnpm install', command: 'pnpm', args: ['install'] }
  const build: PlanStep = { label: 'pnpm run build', command: 'pnpm', args: ['run', 'build'] }
  return {
    version: 1,
    anchor: facts.gitRoot ?? facts.anchor,
    fromSha,
    toSha,
    trackedRef: config.trackedRef,
    steps: [
      { label: `git fetch origin ${config.trackedRef}`, command: 'git', args: ['fetch', 'origin', config.trackedRef] },
      { label: 'git pull --ff-only', command: 'git', args: ['pull', '--ff-only'] },
      pnpmInstall,
      build,
    ],
    rollback: [
      { label: `git reset --hard ${fromSha}`, command: 'git', args: ['reset', '--hard', fromSha] },
      pnpmInstall,
      build,
    ],
    restart: snapshotRestart(),
    waitPids: [process.pid],
    waitTimeoutMs: 120_000,
    stepTimeoutMs: 30 * 60_000,
    dshHome: resolveDshHome(),
    statusFile: statusFilePath(),
    startedAt: Date.now(),
  }
}

/** Write the plan file under the DSH home. */
export function writePlan(plan: UpgradePlan, home: string = plan.dshHome): string {
  mkdirSync(home, { recursive: true })
  const path = planFilePath(home)
  writeFileSync(path, `${JSON.stringify(plan, undefined, 2)}\n`, 'utf8')
  return path
}

/** Locate the built supervisor entry beside this module's artifact. */
export function supervisorEntry(): string {
  return fileURLToPath(new URL('./supervisor.js', import.meta.url))
}

/**
 * Spawn the detached supervisor.
 *
 * Detachment follows the platform rules: a new process group on Unix, a
 * detached process on Windows, so the updater survives the host it is
 * upgrading. Output goes only to the status file — no controlling terminal is
 * assumed to exist by the time steps run.
 */
export function spawnSupervisor(planPath: string): void {
  const child = spawn(process.execPath, [supervisorEntry(), planPath], {
    detached: true,
    stdio: 'ignore',
    cwd: process.cwd(),
    env: { ...process.env },
    windowsHide: true,
  })
  child.unref()
}

/**
 * Verify the quiet-tree preconditions before any plan is built: clean worktree
 * and an allowlisted origin. Returns a rejection reason, or undefined when
 * the tree is ready.
 */
export async function preflightSource(
  facts: VersionFacts,
  config: ChannelConfig,
  run: CommandRunner,
): Promise<string | undefined> {
  if (facts.gitRoot === undefined) {
    return 'this installation is not a git worktree — the source upgrade channel needs a checkout'
  }
  const status = await run('git', ['status', '--porcelain'], { cwd: facts.gitRoot })
  if (!status.ok) {
    return `git status failed: ${status.stderr.trim() !== '' ? status.stderr.trim() : status.stdout.trim()}`
  }
  const dirty = status.stdout.split('\n').filter(line => line.trim() !== '')
  if (dirty.length > 0) {
    const files = dirty.slice(0, 5).map(line => line.trim()).join(', ')
    return `worktree is dirty (${String(dirty.length)} changed path${dirty.length === 1 ? '' : 's'}: ${files}${dirty.length > 5 ? ', …' : ''}) — commit or stash first`
  }
  const remote = await run('git', ['remote', 'get-url', 'origin'], { cwd: facts.gitRoot })
  if (!remote.ok) {
    return 'git remote origin is not configured'
  }
  const origin = remote.stdout.trim()
  if (!originAllowed(config.originAllowlist, origin)) {
    return `origin ${origin} is not in the allowlist — refusing to upgrade`
  }
  return undefined
}
