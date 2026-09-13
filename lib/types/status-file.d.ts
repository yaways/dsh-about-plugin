/**
 * The upgrade status file: one append-only JSONL record under `$DSH_HOME`.
 *
 * Every attempt appends timestamped entries (started, per-step outcomes,
 * restarted / verified / failed / rolled-back); the retention is bounded so
 * the file cannot grow without limit. Any surface's next start reads the tail
 * and surfaces the newest non-terminal entry, so a torn upgrade stays visible
 * even when nobody was watching the window.
 */
import type { HistoryEntry } from './schemas.ts';
/** Status file name inside the DSH home. */
export declare const STATUS_FILE_NAME = "update-log.jsonl";
/** Entries retained after a trim. */
export declare const RETAINED_ENTRIES = 200;
/** Absolute status-file path for one home. */
export declare function statusFilePath(home?: string): string;
/** Ensure the home directory exists and append one entry. */
export declare function appendEntry(home: string, entry: HistoryEntry): void;
/** Read the most recent entries, oldest first. */
export declare function readEntries(home: string, limit: number): HistoryEntry[];
/** Whether one entry closes an upgrade attempt. */
export declare function isTerminal(entry: HistoryEntry): boolean;
/**
 * Find the newest non-terminal entry for one anchor, if any.
 * @returns the entry and its index in the returned tail, or undefined.
 */
export declare function pendingFor(entries: readonly HistoryEntry[], anchor: string): {
    readonly entry: HistoryEntry;
    readonly index: number;
} | undefined;
/**
 * Find the newest entry for one anchor, terminal or not — the reconciliation
 * read: a `restarted` closer still owes its `verified` handshake, so the
 * newest-for-anchor row, not the newest pending row, decides it.
 */
export declare function lastFor(entries: readonly HistoryEntry[], anchor: string): HistoryEntry | undefined;
//# sourceMappingURL=status-file.d.ts.map