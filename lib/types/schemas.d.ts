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
import { z } from 'zod';
/** How the running dsh was installed; decides which upgrade channel applies. */
export type InstallForm = 'source' | 'npm' | 'unknown';
/** Version facts read from the running installation's own manifest. */
export interface VersionFacts {
    /** Version of the running dsh (the same read `dsh --version` performs). */
    readonly version: string;
    /** Absolute path of the installation anchor package directory. */
    readonly anchor: string;
    /** Detected install form. */
    readonly form: InstallForm;
    /** Git worktree root when the source form is detected. */
    readonly gitRoot?: string;
}
/** One upgrade channel's availability row. */
export interface ChannelRow {
    readonly channel: 'source' | 'npm';
    readonly available: boolean;
    /** Why the channel is unavailable, when it is. */
    readonly note?: string;
}
/** Engine (launcher-side `dsh update` subcommands) availability facts. */
export interface EngineFacts {
    /** First dsh version whose launcher ships the `dsh update` engine. */
    readonly requiredVersion: string;
    /**
     * Whether the running launcher answers `dsh update`. `null` means not
     * probed yet (the probe is lazy: it only runs when an upgrade is applied).
     */
    readonly available: boolean | null;
}
/** One append-only record from the upgrade status file. */
export interface HistoryEntry {
    /** Wall-clock milliseconds when the entry was appended. */
    readonly at: number;
    /** Lifecycle event vocabulary. */
    readonly event: 'started' | 'step-ok' | 'step-failed' | 'restarted' | 'verified' | 'failed' | 'rolled-back' | 'orphaned';
    /** Human-readable detail (step command, failure reason, …). */
    readonly detail?: string;
    /** Installation anchor the entry belongs to. */
    readonly anchor?: string;
    /** Upgrade source (recorded commit SHA or version). */
    readonly from?: string;
    /** Upgrade target (commit SHA or version). */
    readonly to?: string;
}
/** `update/status` result: everything the About panel renders at rest. */
export interface UpdateStatus {
    /** This plugin's own package version. */
    readonly pluginVersion: string;
    /** Version facts of the running dsh installation. */
    readonly dsh: VersionFacts;
    /** Engine availability. */
    readonly engine: EngineFacts;
    /** Per-channel availability rows. */
    readonly channels: readonly ChannelRow[];
    /** Most recent status-file entries, oldest first. */
    readonly history: readonly HistoryEntry[];
    /** Absolute path of the status file, for diagnostics. */
    readonly statusFile: string;
}
/** One incoming commit in a source-channel changelog preview. */
export interface IncomingCommit {
    readonly sha: string;
    readonly subject: string;
}
/** Source-channel comparison result. */
export interface SourceCheck {
    readonly channel: 'source';
    /** Commit SHA currently checked out. */
    readonly currentSha: string;
    /** Commit SHA the tracked remote ref points at after the fetch. */
    readonly targetSha: string;
    /** Configured tracked ref name (for example `master`). */
    readonly trackedRef: string;
    /** Resolved remote-tracking ref (for example `origin/master`). */
    readonly remoteRef: string;
    /** Commits the target is ahead of HEAD. */
    readonly behind: number;
    /** Commits HEAD is ahead of the target (a local-only state). */
    readonly ahead: number;
    /** `behind === 0`. */
    readonly upToDate: boolean;
    /** Whether the worktree carries uncommitted changes. */
    readonly dirty: boolean;
    /** Dirty file paths, capped. */
    readonly dirtyFiles: readonly string[];
    /** Changelog preview of the incoming commits, capped. */
    readonly incoming: readonly IncomingCommit[];
    /** Whether a network fetch ran for this check. */
    readonly fetched: boolean;
    /** Failure reason; present only when the channel errored. */
    readonly error?: string;
}
/** npm-channel comparison result. */
export interface NpmCheck {
    readonly channel: 'npm';
    /** Installed dsh version. */
    readonly installed: string;
    /** Version the configured dist-tag points at. */
    readonly latest: string;
    /** Dist-tag that was read (default `latest`). */
    readonly distTag: string;
    /** Installed version satisfies the dist-tag version. */
    readonly upToDate: boolean;
    /** Failure reason; present only when the channel errored. */
    readonly error?: string;
}
/** `update/check` result: channel-aware target comparison, never merged. */
export interface CheckResult {
    /** Wall-clock milliseconds when the check completed. */
    readonly checkedAt: number;
    /** Install form the check ran against. */
    readonly form: InstallForm;
    /** Running dsh version. */
    readonly version: string;
    /** Source-channel result, when that channel ran. */
    readonly source?: SourceCheck;
    /** npm-channel result, when that channel ran. */
    readonly npm?: NpmCheck;
}
/** `update/apply` result. */
export interface ApplyResult {
    /** Whether a supervised upgrade was started (or delegated). */
    readonly accepted: boolean;
    /** Which apply path answered. */
    readonly mode: 'plugin-local' | 'engine' | 'rejected';
    /** Why the request was rejected, when it was. */
    readonly reason?: string;
    /** Recorded pre-upgrade commit SHA. */
    readonly fromSha?: string;
    /** Status file the sequence writes to. */
    readonly statusFile: string;
}
export declare const updateStatusSchema: z.ZodReadonly<z.ZodObject<{
    pluginVersion: z.ZodString;
    dsh: z.ZodReadonly<z.ZodObject<{
        version: z.ZodString;
        anchor: z.ZodString;
        form: z.ZodEnum<{
            source: "source";
            npm: "npm";
            unknown: "unknown";
        }>;
        gitRoot: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    engine: z.ZodReadonly<z.ZodObject<{
        requiredVersion: z.ZodString;
        available: z.ZodNullable<z.ZodBoolean>;
    }, z.core.$strip>>;
    channels: z.ZodArray<z.ZodReadonly<z.ZodObject<{
        channel: z.ZodEnum<{
            source: "source";
            npm: "npm";
        }>;
        available: z.ZodBoolean;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    history: z.ZodArray<z.ZodReadonly<z.ZodObject<{
        at: z.ZodNumber;
        event: z.ZodEnum<{
            started: "started";
            "step-ok": "step-ok";
            "step-failed": "step-failed";
            restarted: "restarted";
            verified: "verified";
            failed: "failed";
            "rolled-back": "rolled-back";
            orphaned: "orphaned";
        }>;
        detail: z.ZodOptional<z.ZodString>;
        anchor: z.ZodOptional<z.ZodString>;
        from: z.ZodOptional<z.ZodString>;
        to: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    statusFile: z.ZodString;
}, z.core.$strip>>;
export declare const checkResultSchema: z.ZodReadonly<z.ZodObject<{
    checkedAt: z.ZodNumber;
    form: z.ZodEnum<{
        source: "source";
        npm: "npm";
        unknown: "unknown";
    }>;
    version: z.ZodString;
    source: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        channel: z.ZodLiteral<"source">;
        currentSha: z.ZodString;
        targetSha: z.ZodString;
        trackedRef: z.ZodString;
        remoteRef: z.ZodString;
        behind: z.ZodNumber;
        ahead: z.ZodNumber;
        upToDate: z.ZodBoolean;
        dirty: z.ZodBoolean;
        dirtyFiles: z.ZodArray<z.ZodString>;
        incoming: z.ZodArray<z.ZodReadonly<z.ZodObject<{
            sha: z.ZodString;
            subject: z.ZodString;
        }, z.core.$strip>>>;
        fetched: z.ZodBoolean;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    npm: z.ZodOptional<z.ZodReadonly<z.ZodObject<{
        channel: z.ZodLiteral<"npm">;
        installed: z.ZodString;
        latest: z.ZodString;
        distTag: z.ZodString;
        upToDate: z.ZodBoolean;
        error: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
}, z.core.$strip>>;
export declare const applyResultSchema: z.ZodReadonly<z.ZodObject<{
    accepted: z.ZodBoolean;
    mode: z.ZodEnum<{
        "plugin-local": "plugin-local";
        engine: "engine";
        rejected: "rejected";
    }>;
    reason: z.ZodOptional<z.ZodString>;
    fromSha: z.ZodOptional<z.ZodString>;
    statusFile: z.ZodString;
}, z.core.$strip>>;
//# sourceMappingURL=schemas.d.ts.map