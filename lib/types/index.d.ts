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
 * The apply path is entirely plugin-local: it runs its own supervised
 * sequence for this surface. There is deliberately NO delegation to a
 * launcher-side update engine — no released dsh ships one, and pre-wiring a
 * call against a command name and output shape that do not exist is
 * speculation (a future engine may use a different subcommand or schema).
 * If an official engine ever lands, the delegation belongs here and is
 * written against its real, documented interface.
 */
import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { type CommandRunner } from './commands.ts';
import type { ApplyResult, CheckResult, UpdateStatus, VersionFacts } from './schemas.ts';
/** Test seams: production defaults are the real runner and spawner. */
export interface GatewayTools {
    /** Command runner; defaults to the real bounded spawner. */
    readonly runner?: CommandRunner;
    /** Supervisor spawn; defaults to the real detached spawn. */
    readonly spawner?: (planPath: string) => void;
    /** Installation facts override; defaults to live discovery. */
    readonly facts?: VersionFacts;
}
/** Plugin row configuration (validated and defaulted in {@link resolveConfig}). */
export interface PluginConfig {
    readonly trackedRef: string;
    readonly originAllowlist: readonly string[];
    readonly npmPackage: string;
    readonly npmDistTag: string;
    readonly incomingLimit: number;
    readonly dirtyFileLimit: number;
    readonly historyLimit: number;
}
/** Validate and default the Loader row config; unknown keys are ignored. */
export declare function resolveConfig(raw: unknown): PluginConfig;
/**
 * Remote-only service exposing the About panel's update facts and actions.
 * Service plugins default-export their service class; the Loader row's
 * `config` arrives as the constructor's second argument.
 */
export declare class UpdateGateway extends TypertRemoteService {
    private readonly config;
    private readonly facts;
    private readonly runner;
    private readonly spawner;
    constructor(ctx: Context, config?: unknown, tools?: GatewayTools);
    /** Channel configuration derived from the row config. */
    private get channelConfig();
    /** The git worktree identity entries in the status file carry. */
    private get anchor();
    /**
     * Reconcile the status file at mount: a restarted process that finds the
     * anchor's newest entry still at `restarted` appends the `verified`
     * handshake (readiness confirmed, not assumed), and a stale non-terminal
     * entry from a dead supervisor is marked orphaned so a torn upgrade stays
     * visible while freeing later attempts.
     */
    private reconcilePendingAttempt;
    /** Availability rows for both channels under the current form. */
    private channelRows;
    /** Version facts and history for the panel's at-rest view. */
    status(): Promise<UpdateStatus>;
    /** Channel-aware update check: per-channel answers, never merged. */
    check(): Promise<CheckResult>;
    /**
     * Start the plugin-local supervised upgrade for this surface.
     *
     * Preflight fails loud before any change: the source channel requires a
     * clean worktree and an allowlisted origin. The supervisor runs the
     * recorded sequence only after this pid exits; the response reaches the
     * client before this surface exits.
     */
    apply(): Promise<ApplyResult>;
}
export default UpdateGateway;
//# sourceMappingURL=index.d.ts.map