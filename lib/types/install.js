/**
 * Installation discovery: which dsh is running, from where, in what form.
 *
 * The provider mirrors the facts the launcher itself already owns — the
 * installation anchor (the CLI package's package.json, the same read
 * `dsh --version` performs), the `.git` directory beside it, and the packaged
 * executable probe — so the About panel's version facts and the upgrade
 * channels derive from installation state, never from guesses.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
/** The npm package name dsh ships under on the registry channel. */
export const DSH_NPM_PACKAGE = '@deepseek-ai/dsh';
/** Return whether the process reads application modules from a packaged executable's virtual filesystem. */
function isPackagedExecutable() {
    return process.pkg !== undefined;
}
/** Read one package.json, tolerating absence. */
function readManifest(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return undefined;
    }
}
/**
 * Walk up from a directory to the nearest `.git` entry (worktree or file).
 * @returns the directory holding it, or undefined.
 */
function findGitRoot(start) {
    let current = start;
    for (;;) {
        if (existsSync(join(current, '.git')))
            return current;
        const parent = dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
/**
 * Discover the running installation's version facts.
 *
 * The CLI entry script (`process.argv[1]`) sits inside the CLI package in
 * every launch form — source trees run `apps/cli/src/bin.ts` through tsx and
 * npm installs resolve the `dsh` bin into the package — so the nearest
 * package.json above it is the installation anchor `dsh --version` reads.
 * @param entryPath - launch entry to anchor on; defaults to `process.argv[1]`.
 */
export function discoverInstallation(entryPath = process.argv[1]) {
    const fallback = { version: '0.0.0', anchor: process.cwd(), form: 'unknown' };
    if (entryPath === undefined || entryPath === '')
        return fallback;
    if (isPackagedExecutable()) {
        // Packaged desktop executables own their own update lifecycle
        // (electron-updater); this plugin reports the form and does nothing else.
        return { ...fallback, form: 'unknown' };
    }
    let anchorDir;
    try {
        // Resolve symlinks (npm bin links) and relative spellings alike.
        anchorDir = dirname(realpathSync(entryPath));
    }
    catch {
        anchorDir = dirname(entryPath);
    }
    // Walk up to the nearest package.json — the CLI package's own manifest.
    let current = anchorDir;
    let manifest;
    for (;;) {
        manifest = readManifest(join(current, 'package.json'));
        if (manifest !== undefined)
            break;
        const parent = dirname(current);
        if (parent === current)
            return fallback;
        current = parent;
    }
    const version = typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    const gitRoot = findGitRoot(current);
    if (gitRoot !== undefined) {
        return { version, anchor: current, form: 'source', gitRoot };
    }
    if (manifest.name === DSH_NPM_PACKAGE || manifest.name === 'dsh') {
        return { version, anchor: current, form: 'npm' };
    }
    return { version, anchor: current, form: 'unknown' };
}
//# sourceMappingURL=install.js.map