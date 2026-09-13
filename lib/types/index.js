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
 * Version gating follows the published plan: the plugin declares
 * `engines.dsh` in its manifest, checks the running installation's version at
 * mount, and REPORTS a requirement instead of throwing — a too-old engine
 * shows its requirement in the panel, not a broken panel.
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import { readFileSync } from 'node:fs';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { runCommand } from "./commands.js";
import { DEFAULT_CHANNEL_CONFIG, originAllowed, runCheck } from "./channels.js";
import { discoverInstallation } from "./install.js";
import { buildUpgradePlan, preflightSource, spawnSupervisor, writePlan } from "./supervise.js";
import { appendEntry, isTerminal, lastFor, pendingFor, readEntries, statusFilePath } from "./status-file.js";
import { atLeast, resolveDshHome } from "./version.js";
/** Minimum dsh version whose launcher ships the `dsh update` engine. */
export const ENGINE_REQUIRED_VERSION = '0.2.0';
/** How many status-file entries the panel's history view reads. */
const HISTORY_LIMIT = 30;
/** Grace between the apply response and this surface's own exit. */
const EXIT_GRACE_MS = 750;
const DEFAULT_PLUGIN_CONFIG = {
    ...DEFAULT_CHANNEL_CONFIG,
    historyLimit: HISTORY_LIMIT,
};
/** Validate and default the Loader row config; unknown keys are ignored. */
export function resolveConfig(raw) {
    const source = (raw && typeof raw === 'object' ? raw : {});
    const allowlist = Array.isArray(source.originAllowlist)
        ? source.originAllowlist.filter((entry) => typeof entry === 'string')
        : undefined;
    const count = (value, fallback) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 200 ? value : fallback;
    return {
        trackedRef: typeof source.trackedRef === 'string' && source.trackedRef !== ''
            ? source.trackedRef
            : DEFAULT_PLUGIN_CONFIG.trackedRef,
        originAllowlist: allowlist ?? DEFAULT_PLUGIN_CONFIG.originAllowlist,
        npmPackage: typeof source.npmPackage === 'string' && source.npmPackage !== ''
            ? source.npmPackage
            : DEFAULT_PLUGIN_CONFIG.npmPackage,
        npmDistTag: typeof source.npmDistTag === 'string' && source.npmDistTag !== ''
            ? source.npmDistTag
            : DEFAULT_PLUGIN_CONFIG.npmDistTag,
        incomingLimit: count(source.incomingLimit, DEFAULT_PLUGIN_CONFIG.incomingLimit),
        dirtyFileLimit: count(source.dirtyFileLimit, DEFAULT_PLUGIN_CONFIG.dirtyFileLimit),
        historyLimit: count(source.historyLimit, DEFAULT_PLUGIN_CONFIG.historyLimit),
    };
}
/** Read this plugin's own package version from its manifest. */
function pluginVersion() {
    try {
        const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
        return typeof manifest.version === 'string' ? manifest.version : '0.0.0';
    }
    catch {
        return '0.0.0';
    }
}
/**
 * Remote-only service exposing the About panel's update facts and actions.
 * Service plugins default-export their service class; the Loader row's
 * `config` arrives as the constructor's second argument.
 */
let UpdateGateway = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _status_decorators;
    let _check_decorators;
    let _apply_decorators;
    return class UpdateGateway extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _status_decorators = [Remote('status')];
            _check_decorators = [Remote('check')];
            _apply_decorators = [Remote('apply')];
            __esDecorate(this, null, _status_decorators, { kind: "method", name: "status", static: false, private: false, access: { has: obj => "status" in obj, get: obj => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _check_decorators, { kind: "method", name: "check", static: false, private: false, access: { has: obj => "check" in obj, get: obj => obj.check }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _apply_decorators, { kind: "method", name: "apply", static: false, private: false, access: { has: obj => "apply" in obj, get: obj => obj.apply }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        facts;
        runner;
        spawner;
        engineProbe;
        /** Lazily probed engine availability (cached after the first apply). */
        engineAvailable;
        constructor(ctx, config = {}, tools = {}) {
            super(ctx, 'update');
            this.config = resolveConfig(config);
            this.facts = tools.facts ?? discoverInstallation();
            this.runner = tools.runner ?? runCommand;
            this.spawner = tools.spawner ?? spawnSupervisor;
            this.engineProbe = tools.engineProbe ?? (() => this.probeEngine());
            this.engineAvailable = undefined;
            this.ctx.logger.info(`dsh-about-plugin: mounted (dsh ${this.facts.version}, form ${this.facts.form}, `
                + `engine ${atLeast(this.facts.version, ENGINE_REQUIRED_VERSION) ? 'version-sufficient' : `requires >= ${ENGINE_REQUIRED_VERSION}`})`);
            this.reconcilePendingAttempt();
        }
        /** Channel configuration derived from the row config. */
        get channelConfig() {
            return {
                trackedRef: this.config.trackedRef,
                originAllowlist: this.config.originAllowlist,
                npmPackage: this.config.npmPackage,
                npmDistTag: this.config.npmDistTag,
                incomingLimit: this.config.incomingLimit,
                dirtyFileLimit: this.config.dirtyFileLimit,
            };
        }
        /** The git worktree identity entries in the status file carry. */
        get anchor() {
            return this.facts.gitRoot ?? this.facts.anchor;
        }
        /**
         * Reconcile the status file at mount: a restarted process that finds the
         * anchor's newest entry still at `restarted` appends the `verified`
         * handshake (readiness confirmed, not assumed), and a stale non-terminal
         * entry from a dead supervisor is marked orphaned so a torn upgrade stays
         * visible while freeing later attempts.
         */
        reconcilePendingAttempt() {
            try {
                const home = resolveDshHome();
                const last = lastFor(readEntries(home, 50), this.anchor);
                if (last === undefined)
                    return;
                if (last.event === 'restarted') {
                    appendEntry(home, { at: Date.now(), event: 'verified', anchor: this.anchor });
                    return;
                }
                if (isTerminal(last))
                    return;
                const stale = {
                    at: Date.now(),
                    event: 'orphaned',
                    anchor: this.anchor,
                    detail: `previous upgrade attempt is unfinished (last event: ${last.event}${last.detail === undefined ? '' : ` — ${last.detail}`}); the tree may need manual attention or a git reset`,
                };
                appendEntry(home, stale);
            }
            catch {
                // An unreadable status file must not break mounting the panel.
            }
        }
        /** Availability rows for both channels under the current form. */
        channelRows() {
            return [
                this.facts.gitRoot === undefined
                    ? { channel: 'source', available: false, note: 'no git worktree detected for this installation' }
                    : { channel: 'source', available: true },
                this.facts.form === 'unknown'
                    ? { channel: 'npm', available: false, note: 'install form unknown — packaged executables own their updates' }
                    : { channel: 'npm', available: true },
            ];
        }
        /**
         * Probe whether the running launcher ships the `dsh update` engine.
         *
         * The probe runs the launcher's own argument surface (`update --help`) and
         * requires the SUBCOMMAND's own help: a commander program answers any
         * `--help` with its top-level usage and exit code 0 — including a dsh
         * generation with no `update` command at all — so the exit code alone
         * cannot distinguish them. The engine exists iff the printed usage names
         * the update command itself (`Usage: dsh update …`). Cached per process.
         */
        async probeEngine() {
            if (this.engineAvailable !== undefined)
                return this.engineAvailable;
            const entry = process.argv[1];
            if (entry === undefined || entry === '') {
                this.engineAvailable = false;
                return false;
            }
            const probe = await this.runner(process.execPath, [...process.execArgv, entry, 'update', '--help'], { cwd: process.cwd(), timeoutMs: 20_000 });
            this.engineAvailable = probe.ok && /^Usage:\s+\S+\s+update\b/m.test(probe.stdout);
            return this.engineAvailable;
        }
        /** Version facts and history for the panel's at-rest view. */
        async status() {
            return {
                pluginVersion: pluginVersion(),
                dsh: this.facts,
                engine: {
                    requiredVersion: ENGINE_REQUIRED_VERSION,
                    available: this.engineAvailable ?? null,
                },
                channels: this.channelRows(),
                history: readEntries(resolveDshHome(), this.config.historyLimit),
                statusFile: statusFilePath(),
            };
        }
        /** Channel-aware update check: per-channel answers, never merged. */
        async check() {
            const fetch = this.facts.form === 'source';
            return runCheck(this.facts, this.channelConfig, this.runner, fetch);
        }
        /**
         * Start (or delegate) the supervised upgrade.
         *
         * Preflight fails loud before any change: the source channel requires a
         * clean worktree and an allowlisted origin. With the launcher-side engine
         * present the call delegates to `dsh update apply`; otherwise the
         * plugin-local supervisor runs the recorded sequence for this single
         * surface. Either way the response reaches the client before this surface
         * exits.
         */
        async apply() {
            const home = resolveDshHome();
            const statusFile = statusFilePath();
            const reject = (reason) => ({ accepted: false, mode: 'rejected', reason, statusFile });
            if (this.facts.form !== 'source' || this.facts.gitRoot === undefined) {
                return reject('the supervised source upgrade needs a git checkout installation (detected form: '
                    + `${this.facts.form}); npm installs upgrade through the registry channel and packaged executables own their updates`);
            }
            const preflight = await preflightSource(this.facts, this.channelConfig, this.runner);
            if (preflight !== undefined)
                return reject(preflight);
            const head = await this.runner('git', ['rev-parse', 'HEAD'], { cwd: this.facts.gitRoot });
            if (!head.ok) {
                return reject(`git rev-parse HEAD failed: ${head.stderr.trim() !== '' ? head.stderr.trim() : head.stdout.trim()}`);
            }
            const fromSha = head.stdout.trim();
            const target = await this.runner('git', ['rev-parse', `origin/${this.config.trackedRef}`], { cwd: this.facts.gitRoot });
            if (!target.ok)
                return reject(`git rev-parse origin/${this.config.trackedRef} failed — run a check first`);
            const toSha = target.stdout.trim();
            if (fromSha === toSha) {
                return reject(`already at the tracked ${this.config.trackedRef} head (${fromSha.slice(0, 12)})`);
            }
            const pending = pendingFor(readEntries(home, 50), this.facts.gitRoot);
            if (pending !== undefined) {
                return reject(`another upgrade attempt is pending (last event: ${pending.entry.event}) — let it finish or inspect ${statusFile}`);
            }
            // The origin allowlist is re-checked immediately before the plan that
            // will fetch from it is written.
            const origin = await this.runner('git', ['remote', 'get-url', 'origin'], { cwd: this.facts.gitRoot });
            if (!origin.ok || !originAllowed(this.channelConfig.originAllowlist, origin.stdout.trim())) {
                return reject('origin is not in the allowlist — refusing to upgrade');
            }
            if (await this.engineProbe()) {
                // The engine owns the general sequence: multi-surface shutdown through
                // the pid registry, the supervise entry, and the verified handshake.
                // This surface does not exit itself — the engine's shutdown request
                // reaches it through the mounted lifecycle plugin.
                const entry = process.argv[1] ?? 'dsh';
                const engine = await this.runner(process.execPath, [...process.execArgv, entry, 'update', 'apply', '--json'], { cwd: process.cwd(), timeoutMs: 30_000 });
                if (engine.ok) {
                    appendEntry(home, {
                        at: Date.now(), event: 'started', anchor: this.facts.gitRoot,
                        detail: 'delegated to the launcher update engine', from: fromSha, to: toSha,
                    });
                    return { accepted: true, mode: 'engine', fromSha, statusFile };
                }
                return reject(`the engine rejected the apply: ${engine.stderr.trim() !== '' ? engine.stderr.trim() : engine.stdout.trim()}`);
            }
            const plan = buildUpgradePlan(this.facts, this.channelConfig, fromSha, toSha);
            const planPath = writePlan(plan);
            appendEntry(home, {
                at: Date.now(), event: 'started', anchor: this.facts.gitRoot,
                detail: `supervised upgrade via plugin-local supervisor (${plan.steps.length} steps)`,
                from: fromSha, to: toSha,
            });
            this.spawner(planPath);
            // Let the RPC response flush before this surface exits; the supervisor
            // waits for this pid regardless.
            const exit = this.ctx.get('appExit');
            if (typeof exit === 'function') {
                setTimeout(() => {
                    try {
                        exit();
                    }
                    catch {
                        // A launcher without a wired exit hook leaves the surface running;
                        // the supervisor's wait bound turns that into a recorded failure.
                    }
                }, EXIT_GRACE_MS).unref();
            }
            return { accepted: true, mode: 'plugin-local', fromSha, statusFile };
        }
    };
})();
export { UpdateGateway };
export default UpdateGateway;
//# sourceMappingURL=index.js.map