/**
 * Bounded child-command runner for read-side channel probes and the upgrade
 * sequence's git/pnpm calls.
 *
 * Every spawn carries the Windows `.cmd` shim handling the launcher itself
 * uses (CVE-2024-27980 hardened `spawn()` refuses `.cmd` without a shell),
 * a hard timeout, and a byte-capped capture, so a hung `git fetch` can never
 * wedge an RPC. The runner is a plain injectable function so tests substitute
 * deterministic fakes for git, pnpm, and npm without touching this module.
 */
/** One finished command run. */
export interface CommandResult {
    readonly ok: boolean;
    readonly code: number;
    readonly stdout: string;
    readonly stderr: string;
}
/** Options for one run. */
export interface CommandOptions {
    readonly cwd: string;
    /** Wall-clock kill switch in milliseconds; default 60s. */
    readonly timeoutMs?: number;
    /** Extra environment entries merged over `process.env`. */
    readonly env?: Record<string, string>;
}
export type CommandRunner = (command: string, args: readonly string[], options: CommandOptions) => Promise<CommandResult>;
/** Run one command to completion, killing it on timeout. */
export declare const runCommand: CommandRunner;
/** Failure text for a rejected command, trimmed for display. */
export declare function failureOf(result: CommandResult, what: string): string;
//# sourceMappingURL=commands.d.ts.map