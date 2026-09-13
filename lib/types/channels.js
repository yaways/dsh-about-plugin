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
import { failureOf } from "./commands.js";
import { DSH_NPM_PACKAGE } from "./install.js";
import { compareVersions } from "./version.js";
/** Official DeepSeek Harness origins the default allowlist pins. */
export const OFFICIAL_ORIGIN_ALLOWLIST = [
    'https://github.com/deepseek-ai/deepseek-harness.git',
    'https://github.com/deepseek-ai/deepseek-harness',
    'git@github.com:deepseek-ai/deepseek-harness.git',
    'git@github.com:deepseek-ai/deepseek-harness',
];
/** Default channel configuration. */
export const DEFAULT_CHANNEL_CONFIG = {
    trackedRef: 'master',
    originAllowlist: OFFICIAL_ORIGIN_ALLOWLIST,
    npmPackage: DSH_NPM_PACKAGE,
    npmDistTag: 'latest',
    incomingLimit: 20,
    dirtyFileLimit: 20,
};
/** Normalize one origin URL for allowlist comparison. */
function normalizeOrigin(url) {
    return url.trim().replace(/\.git$/, '').replace(/\/+$/, '');
}
/**
 * Whether one origin passes the allowlist.
 * @param allowlist - configured allowlist in any spelling.
 * @param origin - `git remote get-url origin` output.
 */
export function originAllowed(allowlist, origin) {
    const normalized = normalizeOrigin(origin);
    return allowlist.some(entry => normalizeOrigin(entry) === normalized);
}
/** Read the origin remote URL, or undefined when there is none. */
async function readOrigin(run, gitRoot) {
    const result = await run('git', ['remote', 'get-url', 'origin'], { cwd: gitRoot });
    if (!result.ok)
        return undefined;
    const url = result.stdout.trim();
    return url === '' ? undefined : url;
}
/** Count revisions in one `git rev-list --count` range; -1 when the probe fails. */
async function countRange(run, gitRoot, range) {
    const result = await run('git', ['rev-list', '--count', range], { cwd: gitRoot });
    if (!result.ok)
        return -1;
    const count = Number(result.stdout.trim());
    return Number.isSafeInteger(count) && count >= 0 ? count : -1;
}
/**
 * Probe the source channel: fetch the tracked ref and compare.
 * @param facts - discovered installation facts.
 * @param config - channel configuration.
 * @param run - command runner.
 * @param fetch - whether to run the network fetch; false reads only local refs.
 * @returns the source-channel comparison row.
 */
export async function checkSourceChannel(facts, config, run, fetch) {
    const remoteRef = `origin/${config.trackedRef}`;
    if (facts.gitRoot === undefined) {
        return {
            channel: 'source', currentSha: '', targetSha: '', trackedRef: config.trackedRef,
            remoteRef, behind: 0, ahead: 0, upToDate: true,
            dirty: false, dirtyFiles: [], incoming: [], fetched: false,
            error: 'no git worktree detected for this installation',
        };
    }
    const gitRoot = facts.gitRoot;
    const state = {
        currentSha: '', targetSha: '', behind: 0, ahead: 0, upToDate: true,
        dirty: false, dirtyFiles: [], incoming: [], fetched: false,
    };
    const origin = await readOrigin(run, gitRoot);
    if (origin === undefined) {
        return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef, error: 'git remote origin is not configured' };
    }
    if (!originAllowed(config.originAllowlist, origin)) {
        return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef, error: `origin ${origin} is not in the allowlist — refusing to fetch` };
    }
    if (fetch) {
        const fetched = await run('git', ['fetch', 'origin', config.trackedRef], { cwd: gitRoot, timeoutMs: 120_000 });
        if (!fetched.ok)
            return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef, error: failureOf(fetched, 'git fetch failed') };
        state.fetched = true;
    }
    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot });
    if (!head.ok)
        return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef, error: failureOf(head, 'git rev-parse HEAD failed') };
    state.currentSha = head.stdout.trim();
    const target = await run('git', ['rev-parse', remoteRef], { cwd: gitRoot });
    if (!target.ok) {
        return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef, error: failureOf(target, `git rev-parse ${remoteRef} failed (fetch first)`) };
    }
    state.targetSha = target.stdout.trim();
    state.behind = await countRange(run, gitRoot, `HEAD..${remoteRef}`);
    state.ahead = await countRange(run, gitRoot, `${remoteRef}..HEAD`);
    if (state.behind < 0 || state.ahead < 0) {
        return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef, error: 'git rev-list --count failed' };
    }
    state.upToDate = state.behind === 0;
    const status = await run('git', ['status', '--porcelain'], { cwd: gitRoot });
    if (status.ok) {
        const lines = status.stdout.split('\n').map(line => line.trim()).filter(line => line !== '');
        state.dirty = lines.length > 0;
        state.dirtyFiles = lines.slice(0, config.dirtyFileLimit);
    }
    if (state.behind > 0) {
        const log = await run('git', ['log', '--oneline', '--no-decorate', '-n', String(config.incomingLimit), `HEAD..${remoteRef}`], { cwd: gitRoot });
        if (log.ok) {
            const incoming = [];
            for (const line of log.stdout.split('\n')) {
                const match = /^([0-9a-f]{7,40})\s+(.*)$/.exec(line.trim());
                if (match !== null)
                    incoming.push({ sha: match[1] ?? '', subject: match[2] ?? '' });
            }
            state.incoming = incoming;
        }
    }
    return { ...state, channel: 'source', trackedRef: config.trackedRef, remoteRef };
}
/**
 * Probe the registry channel: read the dist-tag and compare versions.
 * @param facts - discovered installation facts.
 * @param config - channel configuration.
 * @param run - command runner.
 * @returns the registry-channel comparison row.
 */
export async function checkNpmChannel(facts, config, run) {
    const state = { installed: facts.version, latest: '', upToDate: true };
    const view = await run('npm', ['view', config.npmPackage, 'dist-tags', '--json'], { cwd: process.cwd(), timeoutMs: 60_000 });
    if (!view.ok) {
        return { ...state, channel: 'npm', distTag: config.npmDistTag, error: failureOf(view, `npm view ${config.npmPackage} failed`) };
    }
    let parsed;
    try {
        parsed = JSON.parse(view.stdout);
    }
    catch {
        return { ...state, channel: 'npm', distTag: config.npmDistTag, error: 'npm view returned unparsable output' };
    }
    const tags = (parsed && typeof parsed === 'object' ? parsed : {});
    const latest = tags[config.npmDistTag];
    if (typeof latest !== 'string') {
        return { ...state, channel: 'npm', distTag: config.npmDistTag, error: `dist-tag ${config.npmDistTag} not found for ${config.npmPackage}` };
    }
    state.latest = latest;
    state.upToDate = compareVersions(facts.version, latest) >= 0;
    return { ...state, channel: 'npm', distTag: config.npmDistTag };
}
/**
 * Run every channel that applies to the installation form.
 * @param facts - discovered installation facts.
 * @param config - channel configuration.
 * @param run - command runner.
 * @param fetch - whether the source channel may hit the network.
 * @returns the merged, still per-channel, check result.
 */
export async function runCheck(facts, config, run, fetch) {
    const result = { checkedAt: Date.now(), form: facts.form, version: facts.version };
    if (facts.form === 'source') {
        return { ...result, source: await checkSourceChannel(facts, config, run, fetch) };
    }
    if (facts.form === 'npm') {
        return { ...result, npm: await checkNpmChannel(facts, config, run) };
    }
    return result;
}
//# sourceMappingURL=channels.js.map