/**
 * Upgrade channels: per-form target resolution and comparison.
 *
 * Channels are answered per form and never merged — the source tree can lead
 * the registry's `latest` dist-tag by design, so "is there an update" is a
 * per-channel question. Every network-touching path (fetch, pull) is gated on
 * the origin allowlist first: the updater executes a fixed command vocabulary
 * against a pinned official remote, never against whatever a repository
 * happens to point at today.
 */
import type { CommandRunner } from './commands.ts';
import type { CheckResult, NpmCheck, SourceCheck, VersionFacts } from './schemas.ts';
/** Official DeepSeek Harness origins the default allowlist pins. */
export declare const OFFICIAL_ORIGIN_ALLOWLIST: readonly string[];
/** Channel configuration resolved from the plugin row. */
export interface ChannelConfig {
    /** Ref the source channel follows, without the `origin/` prefix. */
    readonly trackedRef: string;
    /** git origins fetch/pull may run against. */
    readonly originAllowlist: readonly string[];
    /** npm package the registry channel reads. */
    readonly npmPackage: string;
    /** Dist-tag the registry channel reads. */
    readonly npmDistTag: string;
    /** Cap for changelog preview rows. */
    readonly incomingLimit: number;
    /** Cap for dirty-file listings. */
    readonly dirtyFileLimit: number;
}
/** Default channel configuration. */
export declare const DEFAULT_CHANNEL_CONFIG: ChannelConfig;
/**
 * Whether one origin passes the allowlist.
 * @param allowlist - configured allowlist in any spelling.
 * @param origin - `git remote get-url origin` output.
 */
export declare function originAllowed(allowlist: readonly string[], origin: string): boolean;
/**
 * Probe the source channel: fetch the tracked ref and compare.
 * @param facts - discovered installation facts.
 * @param config - channel configuration.
 * @param run - command runner.
 * @param fetch - whether to run the network fetch; false reads only local refs.
 * @returns the source-channel comparison row.
 */
export declare function checkSourceChannel(facts: VersionFacts, config: ChannelConfig, run: CommandRunner, fetch: boolean): Promise<SourceCheck>;
/**
 * Probe the registry channel: read the dist-tag and compare versions.
 * @param facts - discovered installation facts.
 * @param config - channel configuration.
 * @param run - command runner.
 * @returns the registry-channel comparison row.
 */
export declare function checkNpmChannel(facts: VersionFacts, config: ChannelConfig, run: CommandRunner): Promise<NpmCheck>;
/**
 * Run every channel that applies to the installation form.
 * @param facts - discovered installation facts.
 * @param config - channel configuration.
 * @param run - command runner.
 * @param fetch - whether the source channel may hit the network.
 * @returns the merged, still per-channel, check result.
 */
export declare function runCheck(facts: VersionFacts, config: ChannelConfig, run: CommandRunner, fetch: boolean): Promise<CheckResult>;
//# sourceMappingURL=channels.d.ts.map