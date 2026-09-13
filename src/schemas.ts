/**
 * Wire payload schemas for the `update` Remote namespace.
 *
 * One schema module feeds both hand-written Typert artifacts — the Host face
 * (`src/typert.ts`, registered by dsh-typert-loader for strict gateway
 * validation) and the Client face (`src/remote.ts`, mounted by this plugin's
 * own browser half). The artifacts are hand-written to the exact shape the
 * Typert generator emits for in-tree packages, because a standalone plugin
 * has no access to the repository's generation pipeline; keeping the schemas
 * in one module means the two faces cannot drift.
 */

import { z } from 'zod'

/** How the running dsh was installed; decides which upgrade channel applies. */
export type InstallForm = 'source' | 'npm' | 'unknown'

/** Version facts read from the running installation's own manifest. */
export interface VersionFacts {
  /** Version of the running dsh (the same read `dsh --version` performs). */
  readonly version: string
  /** Absolute path of the installation anchor package directory. */
  readonly anchor: string
  /** Detected install form. */
  readonly form: InstallForm
  /** Git worktree root when the source form is detected. */
  readonly gitRoot?: string
}

/** One upgrade channel's availability row. */
export interface ChannelRow {
  readonly channel: 'source' | 'npm'
  readonly available: boolean
  /** Why the channel is unavailable, when it is. */
  readonly note?: string
}

/** One append-only record from the upgrade status file. */
export interface HistoryEntry {
  /** Wall-clock milliseconds when the entry was appended. */
  readonly at: number
  /** Lifecycle event vocabulary. */
  readonly event:
    | 'started'
    | 'step-ok'
    | 'step-failed'
    | 'restarted'
    | 'verified'
    | 'failed'
    | 'rolled-back'
    | 'orphaned'
  /** Human-readable detail (step command, failure reason, …). */
  readonly detail?: string
  /** Installation anchor the entry belongs to. */
  readonly anchor?: string
  /** Upgrade source (recorded commit SHA or version). */
  readonly from?: string
  /** Upgrade target (commit SHA or version). */
  readonly to?: string
}

/** `update/status` result: everything the About panel renders at rest. */
export interface UpdateStatus {
  /** This plugin's own package version. */
  readonly pluginVersion: string
  /** Version facts of the running dsh installation. */
  readonly dsh: VersionFacts
  /** Per-channel availability rows. */
  readonly channels: readonly ChannelRow[]
  /** Most recent status-file entries, oldest first. */
  readonly history: readonly HistoryEntry[]
  /** Absolute path of the status file, for diagnostics. */
  readonly statusFile: string
}

/** One incoming commit in a source-channel changelog preview. */
export interface IncomingCommit {
  readonly sha: string
  readonly subject: string
}

/** Source-channel comparison result. */
export interface SourceCheck {
  readonly channel: 'source'
  /** Commit SHA currently checked out. */
  readonly currentSha: string
  /** Commit SHA the tracked remote ref points at after the fetch. */
  readonly targetSha: string
  /** Configured tracked ref name (for example `master`). */
  readonly trackedRef: string
  /** Resolved remote-tracking ref (for example `origin/master`). */
  readonly remoteRef: string
  /** Commits the target is ahead of HEAD. */
  readonly behind: number
  /** Commits HEAD is ahead of the target (a local-only state). */
  readonly ahead: number
  /** `behind === 0`. */
  readonly upToDate: boolean
  /** Whether the worktree carries uncommitted changes. */
  readonly dirty: boolean
  /** Dirty file paths, capped. */
  readonly dirtyFiles: readonly string[]
  /** Changelog preview of the incoming commits, capped. */
  readonly incoming: readonly IncomingCommit[]
  /** Whether a network fetch ran for this check. */
  readonly fetched: boolean
  /** Failure reason; present only when the channel errored. */
  readonly error?: string
}

/** npm-channel comparison result. */
export interface NpmCheck {
  readonly channel: 'npm'
  /** Installed dsh version. */
  readonly installed: string
  /** Version the configured dist-tag points at. */
  readonly latest: string
  /** Dist-tag that was read (default `latest`). */
  readonly distTag: string
  /** Installed version satisfies the dist-tag version. */
  readonly upToDate: boolean
  /** Failure reason; present only when the channel errored. */
  readonly error?: string
}

/** `update/check` result: channel-aware target comparison, never merged. */
export interface CheckResult {
  /** Wall-clock milliseconds when the check completed. */
  readonly checkedAt: number
  /** Install form the check ran against. */
  readonly form: InstallForm
  /** Running dsh version. */
  readonly version: string
  /** Source-channel result, when that channel ran. */
  readonly source?: SourceCheck
  /** npm-channel result, when that channel ran. */
  readonly npm?: NpmCheck
}

/** `update/apply` result. */
export interface ApplyResult {
  /** Whether a supervised upgrade was started. */
  readonly accepted: boolean
  /** Which apply path answered. */
  readonly mode: 'plugin-local' | 'rejected'
  /** Why the request was rejected, when it was. */
  readonly reason?: string
  /** Recorded pre-upgrade commit SHA. */
  readonly fromSha?: string
  /** Status file the sequence writes to. */
  readonly statusFile: string
}

const installForm = z.enum(['source', 'npm', 'unknown'])

const versionFacts = z.object({
  version: z.string(),
  anchor: z.string(),
  form: installForm,
  gitRoot: z.string().optional(),
}).readonly()

const channelRow = z.object({
  channel: z.enum(['source', 'npm']),
  available: z.boolean(),
  note: z.string().optional(),
}).readonly()

const historyEntry = z.object({
  at: z.number(),
  event: z.enum([
    'started', 'step-ok', 'step-failed', 'restarted', 'verified', 'failed', 'rolled-back', 'orphaned',
  ]),
  detail: z.string().optional(),
  anchor: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
}).readonly()

export const updateStatusSchema = z.object({
  pluginVersion: z.string(),
  dsh: versionFacts,
  channels: z.array(channelRow),
  history: z.array(historyEntry),
  statusFile: z.string(),
}).readonly()

const incomingCommit = z.object({
  sha: z.string(),
  subject: z.string(),
}).readonly()

const sourceCheck = z.object({
  channel: z.literal('source'),
  currentSha: z.string(),
  targetSha: z.string(),
  trackedRef: z.string(),
  remoteRef: z.string(),
  behind: z.number().int().nonnegative(),
  ahead: z.number().int().nonnegative(),
  upToDate: z.boolean(),
  dirty: z.boolean(),
  dirtyFiles: z.array(z.string()),
  incoming: z.array(incomingCommit),
  fetched: z.boolean(),
  error: z.string().optional(),
}).readonly()

const npmCheck = z.object({
  channel: z.literal('npm'),
  installed: z.string(),
  latest: z.string(),
  distTag: z.string(),
  upToDate: z.boolean(),
  error: z.string().optional(),
}).readonly()

export const checkResultSchema = z.object({
  checkedAt: z.number(),
  form: installForm,
  version: z.string(),
  source: sourceCheck.optional(),
  npm: npmCheck.optional(),
}).readonly()

export const applyResultSchema = z.object({
  accepted: z.boolean(),
  mode: z.enum(['plugin-local', 'rejected']),
  reason: z.string().optional(),
  fromSha: z.string().optional(),
  statusFile: z.string(),
}).readonly()
