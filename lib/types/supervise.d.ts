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
import type { CommandRunner } from './commands.ts';
import { type ChannelConfig } from './channels.ts';
import type { VersionFacts } from './schemas.ts';
/** Plan file name inside the DSH home. */
export declare const PLAN_FILE_NAME = "update-plan.json";
/** One recorded command in the sequence. */
export interface PlanStep {
    readonly label: string;
    readonly command: string;
    readonly args: readonly string[];
}
/** The snapshot of the launcher invocation to restart. */
export interface PlanRestart {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd: string;
}
/** The serialized upgrade plan the detached supervisor consumes. */
export interface UpgradePlan {
    readonly version: 1;
    /** Git worktree root; every step's cwd. */
    readonly anchor: string;
    /** Commit SHA recorded before the upgrade. */
    readonly fromSha: string;
    /** Commit SHA the tracked remote ref resolved to. */
    readonly toSha: string;
    /** Tracked ref name, for the recorded fetch. */
    readonly trackedRef: string;
    /** Steps between quiet tree and restart. */
    readonly steps: readonly PlanStep[];
    /** Steps that restore the recorded SHA when a step fails. */
    readonly rollback: readonly PlanStep[];
    /** The launcher invocation to restart. */
    readonly restart: PlanRestart;
    /** Pids the supervisor waits for before touching the tree. */
    readonly waitPids: readonly number[];
    /** Bound on the wait, in milliseconds. */
    readonly waitTimeoutMs: number;
    /** Per-step bound, in milliseconds. */
    readonly stepTimeoutMs: number;
    /** DSH home the status file lives under. */
    readonly dshHome: string;
    /** Absolute status-file path. */
    readonly statusFile: string;
    readonly startedAt: number;
}
/** Absolute plan-file path for one home. */
export declare function planFilePath(home?: string): string;
/** Snapshot the current process's launcher invocation. */
export declare function snapshotRestart(): PlanRestart;
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
export declare function buildUpgradePlan(facts: VersionFacts, config: ChannelConfig, fromSha: string, toSha: string): UpgradePlan;
/** Write the plan file under the DSH home. */
export declare function writePlan(plan: UpgradePlan, home?: string): string;
/** Locate the built supervisor entry beside this module's artifact. */
export declare function supervisorEntry(): string;
/**
 * Spawn the detached supervisor.
 *
 * Detachment follows the platform rules: a new process group on Unix, a
 * detached process on Windows, so the updater survives the host it is
 * upgrading. Output goes only to the status file — no controlling terminal is
 * assumed to exist by the time steps run.
 */
export declare function spawnSupervisor(planPath: string): void;
/**
 * Verify the quiet-tree preconditions before any plan is built: clean worktree
 * and an allowlisted origin. Returns a rejection reason, or undefined when
 * the tree is ready.
 */
export declare function preflightSource(facts: VersionFacts, config: ChannelConfig, run: CommandRunner): Promise<string | undefined>;
//# sourceMappingURL=supervise.d.ts.map