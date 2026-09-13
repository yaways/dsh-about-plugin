/**
 * The upgrade status file: one append-only JSONL record under `$DSH_HOME`.
 *
 * Every attempt appends timestamped entries (started, per-step outcomes,
 * restarted / verified / failed / rolled-back); the retention is bounded so
 * the file cannot grow without limit. Any surface's next start reads the tail
 * and surfaces the newest non-terminal entry, so a torn upgrade stays visible
 * even when nobody was watching the window.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveDshHome } from "./version.js";
/** Status file name inside the DSH home. */
export const STATUS_FILE_NAME = 'update-log.jsonl';
/** Entries retained after a trim. */
export const RETAINED_ENTRIES = 200;
/** Absolute status-file path for one home. */
export function statusFilePath(home = resolveDshHome()) {
    return join(home, STATUS_FILE_NAME);
}
/** Ensure the home directory exists and append one entry. */
export function appendEntry(home, entry) {
    mkdirSync(home, { recursive: true });
    appendFileSync(statusFilePath(home), `${JSON.stringify(entry)}\n`, 'utf8');
    trim(home);
}
/**
 * Trim the file to the retention bound. Best-effort: a trim failure never
 * blocks the upgrade sequence itself.
 */
function trim(home) {
    const path = statusFilePath(home);
    let lines;
    try {
        lines = readFileSync(path, 'utf8').split('\n').filter(line => line.trim() !== '');
    }
    catch {
        return;
    }
    if (lines.length <= RETAINED_ENTRIES)
        return;
    const trimmed = lines.slice(lines.length - RETAINED_ENTRIES);
    const temporary = `${path}.tmp`;
    try {
        writeFileSync(temporary, `${trimmed.join('\n')}\n`, 'utf8');
        renameSync(temporary, path);
    }
    catch {
        // A concurrent writer or a read-only home: the next successful trim
        // retries; unbounded growth is bounded by attempt frequency either way.
    }
}
/** Read the most recent entries, oldest first. */
export function readEntries(home, limit) {
    const path = statusFilePath(home);
    if (!existsSync(path))
        return [];
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    }
    catch {
        return [];
    }
    const entries = [];
    for (const line of raw.split('\n')) {
        if (line.trim() === '')
            continue;
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            // A torn final line (crash mid-append) is skipped, not fatal.
        }
    }
    return entries.slice(Math.max(0, entries.length - limit));
}
/** Event vocabulary that closes an attempt. */
const TERMINAL_EVENTS = new Set(['restarted', 'verified', 'failed', 'rolled-back', 'orphaned']);
/** Whether one entry closes an upgrade attempt. */
export function isTerminal(entry) {
    return TERMINAL_EVENTS.has(entry.event);
}
/**
 * Find the newest non-terminal entry for one anchor, if any.
 * @returns the entry and its index in the returned tail, or undefined.
 */
export function pendingFor(entries, anchor) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry === undefined)
            continue;
        if (isTerminal(entry))
            return undefined;
        if (entry.anchor === anchor)
            return { entry, index };
    }
    return undefined;
}
/**
 * Find the newest entry for one anchor, terminal or not — the reconciliation
 * read: a `restarted` closer still owes its `verified` handshake, so the
 * newest-for-anchor row, not the newest pending row, decides it.
 */
export function lastFor(entries, anchor) {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index];
        if (entry?.anchor === anchor)
            return entry;
    }
    return undefined;
}
//# sourceMappingURL=status-file.js.map