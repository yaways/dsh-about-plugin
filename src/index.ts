/**
 * Host half of dsh-about-plugin: the `update` Remote service.
 *
 * The service exposes three parameterless methods over Typert Remote —
 * `update/status`, `update/check`, `update/apply` — following the
 * plugin-inventory precedent for Remote-only services. Strict gateway
 * validation comes from the hand-written `./typert` artifact (registered by
 * dsh-typert-loader when this package's Loader entry mounts); the browser
 * half mounts its own `./remote` artifact, so nothing here requires a change
 * in the application's Remote assembly.
 *
 * Version gating follows the published plan: the plugin declares
 * `engines.dsh` in its manifest, checks the running installation's version at
 * mount, and REPORTS a requirement instead of throwing — a too-old engine
 * shows its requirement in the panel, not a broken panel.
 */

import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { runCommand, type CommandRunner } from './commands.ts'
import { DEFAULT_CHANNEL_CONFIG, originAllowed, runCheck, type ChannelConfig } from './channels.ts'
import { discoverInstallation } from './install.ts'
import { buildUpgradePlan, preflightSource, spawnSupervisor, writePlan } from './supervise.ts'
import { appendEntry, isTerminal, lastFor, pendingFor, readEntries, statusFilePath } from './status-file.ts'
import type {
  ApplyResult, ChannelRow, CheckResult, HistoryEntry, UpdateStatus, VersionFacts,
} from './schemas.ts'
import { atLeast, resolveDshHome } from './version.ts'

/** Minimum dsh version whose launcher ships the `dsh update` engine. */
export const ENGINE_REQUIRED_VERSION = '0.2.0'

/** How many status-file entries the panel's history view reads. */
const HISTORY_LIMIT = 30

/** Grace between the apply response and this surface's own exit. */
const EXIT_GRACE_MS = 750

/** Test seams: production defaults are the real runner, spawner, and prober. */
export interface GatewayTools {
  /** Command runner; defaults to the real bounded spawner. */
  readonly runner?: CommandRunner
  /** Supervisor spawn; defaults to the real detached spawn. */
  readonly spawner?: (planPath: string) => void
  /** Engine probe override. */
  readonly engineProbe?: () => Promise<boolean>
  /** Installation facts override; defaults to live discovery. */
  readonly facts?: VersionFacts
}

/** Plugin row configuration (validated and defaulted in {@link resolveConfig}). */
export interface PluginConfig {
  readonly trackedRef: string
  readonly originAllowlist: readonly string[]
  readonly npmPackage: string
  readonly npmDistTag: string
  readonly incomingLimit: number
  readonly dirtyFileLimit: number
  readonly historyLimit: number
}

const DEFAULT_PLUGIN_CONFIG: PluginConfig = {
  ...DEFAULT_CHANNEL_CONFIG,
  historyLimit: HISTORY_LIMIT,
}

/** Validate and default the Loader row config; unknown keys are ignored. */
export function resolveConfig(raw: unknown): PluginConfig {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const allowlist = Array.isArray(source.originAllowlist)
    ? source.originAllowlist.filter((entry): entry is string => typeof entry === 'string')
    : undefined
  const count = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 200 ? value : fallback
  return {
    trackedRef: typeof source.trackedRef === 'string' && source.trackedRef !== ''
      ? source.trackedRef
      : DEFAULT_PLUGIN_CONFIG.trackedRef,
    originAllowlist: allowlist ?? DEFAULT_PLUGIN_CONFIG.originAllowlist,
    npmPackage: typeof source.npmPackage === 'string' && source.npmPackage !== ''
      ? source.npmPackage
      : DEFAULT_PLUGIN_CONFIG.npmPackage,
    npmDistTag: typeof source.npmDistTag === 'string' && source.npmDistTag !== ''
      ? source.npmDistTag
      : DEFAULT_PLUGIN_CONFIG.npmDistTag,
    incomingLimit: count(source.incomingLimit, DEFAULT_PLUGIN_CONFIG.incomingLimit),
    dirtyFileLimit: count(source.dirtyFileLimit, DEFAULT_PLUGIN_CONFIG.dirtyFileLimit),
    historyLimit: count(source.historyLimit, DEFAULT_PLUGIN_CONFIG.historyLimit),
  }
}

/** Read this plugin's own package version from its manifest. */
function pluginVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/**
 * Remote-only service exposing the About panel's update facts and actions.
 * Service plugins default-export their service class; the Loader row's
 * `config` arrives as the constructor's second argument.
 */
export class UpdateGateway extends TypertRemoteService {
  private readonly config: PluginConfig
  private readonly facts: VersionFacts
  private readonly runner: CommandRunner
  private readonly spawner: (planPath: string) => void
  private readonly engineProbe: () => Promise<boolean>
  /** Lazily probed engine availability (cached after the first apply). */
  private engineAvailable: boolean | undefined

  constructor(ctx: Context, config: unknown = {}, tools: GatewayTools = {}) {
    super(ctx, 'update')
    this.config = resolveConfig(config)
    this.facts = tools.facts ?? discoverInstallation()
    this.runner = tools.runner ?? runCommand
    this.spawner = tools.spawner ?? spawnSupervisor
    this.engineProbe = tools.engineProbe ?? (() => this.probeEngine())
    this.engineAvailable = undefined
    this.ctx.logger.info(
      `dsh-about-plugin: mounted (dsh ${this.facts.version}, form ${this.facts.form}, `
      + `engine ${atLeast(this.facts.version, ENGINE_REQUIRED_VERSION) ? 'version-sufficient' : `requires >= ${ENGINE_REQUIRED_VERSION}`})`,
    )
    this.reconcilePendingAttempt()
  }

  /** Channel configuration derived from the row config. */
  private get channelConfig(): ChannelConfig {
    return {
      trackedRef: this.config.trackedRef,
      originAllowlist: this.config.originAllowlist,
      npmPackage: this.config.npmPackage,
      npmDistTag: this.config.npmDistTag,
      incomingLimit: this.config.incomingLimit,
      dirtyFileLimit: this.config.dirtyFileLimit,
    }
  }

  /** The git worktree identity entries in the status file carry. */
  private get anchor(): string {
    return this.facts.gitRoot ?? this.facts.anchor
  }

  /**
   * Reconcile the status file at mount: a restarted process that finds the
   * anchor's newest entry still at `restarted` appends the `verified`
   * handshake (readiness confirmed, not assumed), and a stale non-terminal
   * entry from a dead supervisor is marked orphaned so a torn upgrade stays
   * visible while freeing later attempts.
   */
  private reconcilePendingAttempt(): void {
    try {
      const home = resolveDshHome()
      const last = lastFor(readEntries(home, 50), this.anchor)
      if (last === undefined) return
      if (last.event === 'restarted') {
        appendEntry(home, { at: Date.now(), event: 'verified', anchor: this.anchor })
        return
      }
      if (isTerminal(last)) return
      const stale: HistoryEntry = {
        at: Date.now(),
        event: 'orphaned',
        anchor: this.anchor,
        detail: `previous upgrade attempt is unfinished (last event: ${last.event}${last.detail === undefined ? '' : ` — ${last.detail}`}); the tree may need manual attention or a git reset`,
      }
      appendEntry(home, stale)
    } catch {
      // An unreadable status file must not break mounting the panel.
    }
  }

  /** Availability rows for both channels under the current form. */
  private channelRows(): ChannelRow[] {
    return [
      this.facts.gitRoot === undefined
        ? { channel: 'source', available: false, note: 'no git worktree detected for this installation' }
        : { channel: 'source', available: true },
      this.facts.form === 'unknown'
        ? { channel: 'npm', available: false, note: 'install form unknown — packaged executables own their updates' }
        : { channel: 'npm', available: true },
    ]
  }

  /**
   * Probe whether the running launcher ships the `dsh update` engine.
   *
   * The probe runs the launcher's own argument surface (`update --help`
   * exits zero only when the subcommand exists) and is cached per process.
   */
  private async probeEngine(): Promise<boolean> {
    if (this.engineAvailable !== undefined) return this.engineAvailable
    const entry = process.argv[1]
    if (entry === undefined || entry === '') {
      this.engineAvailable = false
      return false
    }
    const probe = await this.runner(
      process.execPath,
      [...process.execArgv, entry, 'update', '--help'],
      { cwd: process.cwd(), timeoutMs: 20_000 },
    )
    this.engineAvailable = probe.ok
    return probe.ok
  }

  /** Version facts and history for the panel's at-rest view. */
  @Remote('status')
  async status(): Promise<UpdateStatus> {
    return {
      pluginVersion: pluginVersion(),
      dsh: this.facts,
      engine: {
        requiredVersion: ENGINE_REQUIRED_VERSION,
        available: this.engineAvailable ?? null,
      },
      channels: this.channelRows(),
      history: readEntries(resolveDshHome(), this.config.historyLimit),
      statusFile: statusFilePath(),
    }
  }

  /** Channel-aware update check: per-channel answers, never merged. */
  @Remote('check')
  async check(): Promise<CheckResult> {
    const fetch = this.facts.form === 'source'
    return runCheck(this.facts, this.channelConfig, this.runner, fetch)
  }

  /**
   * Start (or delegate) the supervised upgrade.
   *
   * Preflight fails loud before any change: the source channel requires a
   * clean worktree and an allowlisted origin. With the launcher-side engine
   * present the call delegates to `dsh update apply`; otherwise the
   * plugin-local supervisor runs the recorded sequence for this single
   * surface. Either way the response reaches the client before this surface
   * exits.
   */
  @Remote('apply')
  async apply(): Promise<ApplyResult> {
    const home = resolveDshHome()
    const statusFile = statusFilePath()
    const reject = (reason: string): ApplyResult => ({ accepted: false, mode: 'rejected', reason, statusFile })
    if (this.facts.form !== 'source' || this.facts.gitRoot === undefined) {
      return reject(
        'the supervised source upgrade needs a git checkout installation (detected form: '
        + `${this.facts.form}); npm installs upgrade through the registry channel and packaged executables own their updates`,
      )
    }
    const preflight = await preflightSource(this.facts, this.channelConfig, this.runner)
    if (preflight !== undefined) return reject(preflight)
    const head = await this.runner('git', ['rev-parse', 'HEAD'], { cwd: this.facts.gitRoot })
    if (!head.ok) {
      return reject(`git rev-parse HEAD failed: ${head.stderr.trim() !== '' ? head.stderr.trim() : head.stdout.trim()}`)
    }
    const fromSha = head.stdout.trim()
    const target = await this.runner('git', ['rev-parse', `origin/${this.config.trackedRef}`], { cwd: this.facts.gitRoot })
    if (!target.ok) return reject(`git rev-parse origin/${this.config.trackedRef} failed — run a check first`)
    const toSha = target.stdout.trim()
    if (fromSha === toSha) {
      return reject(`already at the tracked ${this.config.trackedRef} head (${fromSha.slice(0, 12)})`)
    }
    const pending = pendingFor(readEntries(home, 50), this.facts.gitRoot)
    if (pending !== undefined) {
      return reject(
        `another upgrade attempt is pending (last event: ${pending.entry.event}) — let it finish or inspect ${statusFile}`,
      )
    }
    // The origin allowlist is re-checked immediately before the plan that
    // will fetch from it is written.
    const origin = await this.runner('git', ['remote', 'get-url', 'origin'], { cwd: this.facts.gitRoot })
    if (!origin.ok || !originAllowed(this.channelConfig.originAllowlist, origin.stdout.trim())) {
      return reject('origin is not in the allowlist — refusing to upgrade')
    }
    if (await this.engineProbe()) {
      // The engine owns the general sequence: multi-surface shutdown through
      // the pid registry, the supervise entry, and the verified handshake.
      // This surface does not exit itself — the engine's shutdown request
      // reaches it through the mounted lifecycle plugin.
      const entry = process.argv[1] ?? 'dsh'
      const engine = await this.runner(
        process.execPath,
        [...process.execArgv, entry, 'update', 'apply', '--json'],
        { cwd: process.cwd(), timeoutMs: 30_000 },
      )
      if (engine.ok) {
        appendEntry(home, {
          at: Date.now(), event: 'started', anchor: this.facts.gitRoot,
          detail: 'delegated to the launcher update engine', from: fromSha, to: toSha,
        })
        return { accepted: true, mode: 'engine', fromSha, statusFile }
      }
      return reject(`the engine rejected the apply: ${engine.stderr.trim() !== '' ? engine.stderr.trim() : engine.stdout.trim()}`)
    }
    const plan = buildUpgradePlan(this.facts, this.channelConfig, fromSha, toSha)
    const planPath = writePlan(plan)
    appendEntry(home, {
      at: Date.now(), event: 'started', anchor: this.facts.gitRoot,
      detail: `supervised upgrade via plugin-local supervisor (${plan.steps.length} steps)`,
      from: fromSha, to: toSha,
    })
    this.spawner(planPath)
    // Let the RPC response flush before this surface exits; the supervisor
    // waits for this pid regardless.
    const exit = this.ctx.get('appExit') as (() => void) | undefined
    if (typeof exit === 'function') {
      setTimeout(() => {
        try {
          exit()
        } catch {
          // A launcher without a wired exit hook leaves the surface running;
          // the supervisor's wait bound turns that into a recorded failure.
        }
      }, EXIT_GRACE_MS).unref()
    }
    return { accepted: true, mode: 'plugin-local', fromSha, statusFile }
  }
}

export default UpdateGateway
