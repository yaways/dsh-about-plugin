import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
//#region lib/types/commands.js
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
/** Cap captured output so a misbehaving command cannot exhaust memory. */
const MAX_CAPTURE_BYTES = 524288;
/** Run one command to completion, killing it on timeout. */
const runCommand = (command, args, options) => new Promise((resolve) => {
	const child = spawn(command, args, {
		cwd: options.cwd,
		shell: process.platform === "win32",
		env: {
			...process.env,
			...options.env
		},
		windowsHide: true
	});
	let stdout = "";
	let stderr = "";
	let settled = false;
	const capture = (side) => (chunk) => {
		const text = chunk.toString("utf8");
		if (side === "out") {
			if (stdout.length < MAX_CAPTURE_BYTES) stdout += text;
		} else if (stderr.length < MAX_CAPTURE_BYTES) stderr += text;
	};
	child.stdout?.on("data", capture("out"));
	child.stderr?.on("data", capture("err"));
	const timeout = setTimeout(() => {
		if (settled) return;
		settled = true;
		child.kill();
		resolve({
			ok: false,
			code: -1,
			stdout,
			stderr: `${stderr}\n[dsh-about-plugin] timed out after ${String(options.timeoutMs ?? 6e4)}ms`
		});
	}, options.timeoutMs ?? 6e4);
	const finish = (ok, code) => {
		if (settled) return;
		settled = true;
		clearTimeout(timeout);
		resolve({
			ok,
			code,
			stdout,
			stderr
		});
	};
	child.on("error", (error) => {
		stderr += `\n${String(error)}`;
		finish(false, -1);
	});
	child.on("close", (code) => finish(code === 0, code ?? -1));
});
/** Failure text for a rejected command, trimmed for display. */
function failureOf(result, what) {
	const detail = result.stderr.trim() !== "" ? result.stderr.trim() : result.stdout.trim();
	return detail !== "" ? `${what}: ${detail}` : `${what} (exit ${String(result.code)})`;
}
//#endregion
//#region lib/types/install.js
/**
* Installation discovery: which dsh is running, from where, in what form.
*
* The provider mirrors the facts the launcher itself already owns — the
* installation anchor (the CLI package's package.json, the same read
* `dsh --version` performs), the `.git` directory beside it, and the packaged
* executable probe — so the About panel's version facts and the upgrade
* channels derive from installation state, never from guesses.
*/
/** The npm package name dsh ships under on the registry channel. */
const DSH_NPM_PACKAGE = "@deepseek-ai/dsh";
/** Return whether the process reads application modules from a packaged executable's virtual filesystem. */
function isPackagedExecutable() {
	return process.pkg !== void 0;
}
/** Read one package.json, tolerating absence. */
function readManifest(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return;
	}
}
/**
* Walk up from a directory to the nearest `.git` entry (worktree or file).
* @returns the directory holding it, or undefined.
*/
function findGitRoot(start) {
	let current = start;
	for (;;) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return void 0;
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
function discoverInstallation(entryPath = process.argv[1]) {
	const fallback = {
		version: "0.0.0",
		anchor: process.cwd(),
		form: "unknown"
	};
	if (entryPath === void 0 || entryPath === "") return fallback;
	if (isPackagedExecutable()) return {
		...fallback,
		form: "unknown"
	};
	let anchorDir;
	try {
		anchorDir = dirname(realpathSync(entryPath));
	} catch {
		anchorDir = dirname(entryPath);
	}
	let current = anchorDir;
	let manifest;
	for (;;) {
		manifest = readManifest(join(current, "package.json"));
		if (manifest !== void 0) break;
		const parent = dirname(current);
		if (parent === current) return fallback;
		current = parent;
	}
	const version = typeof manifest.version === "string" ? manifest.version : "0.0.0";
	const gitRoot = findGitRoot(current);
	if (gitRoot !== void 0) return {
		version,
		anchor: current,
		form: "source",
		gitRoot
	};
	if (manifest.name === "@deepseek-ai/dsh" || manifest.name === "dsh") return {
		version,
		anchor: current,
		form: "npm"
	};
	return {
		version,
		anchor: current,
		form: "unknown"
	};
}
//#endregion
//#region lib/types/version.js
/**
* Version comparison and home-directory resolution helpers.
*
* A compact prerelease-aware SemVer comparator (major.minor.patch with
* dotted numeric prerelease identifiers, the shape every dsh release uses)
* instead of a dependency: the plugin keeps its runtime footprint at zod
* alone. Non-conforming versions compare by string order after the numeric
* fields, which is only a diagnostics path — version gates never reject on
* parse shape, they report.
*/
/** Parse `x.y.z[-pre[.n]…]` into comparable fields. */
function parse(version) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
	if (match === null) return {
		core: [
			-1,
			-1,
			-1
		],
		pre: [],
		raw: version,
		conforming: false
	};
	const core = [
		Number(match[1]),
		Number(match[2]),
		Number(match[3])
	];
	const pre = [];
	if (match[4] !== void 0) for (const part of match[4].split(".")) pre.push(/^\d+$/.test(part) ? Number(part) : part);
	return {
		core,
		pre,
		raw: version,
		conforming: true
	};
}
/** Compare two identifiers per SemVer: numeric < alphanumeric, lexical within. */
function compareIdentifier(left, right) {
	if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1;
	if (typeof left === "number" && typeof right === "number") return left < right ? -1 : left > right ? 1 : 0;
	if (typeof left === "number") return -1;
	if (typeof right === "number") return 1;
	return left < right ? -1 : left > right ? 1 : 0;
}
/** Compare two prerelease identifier runs per SemVer: shorter is lower when equal so far. */
function comparePrerelease(left, right) {
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index += 1) {
		const order = compareIdentifier(left[index] ?? null, right[index] ?? null);
		if (order !== 0) return order;
	}
	return 0;
}
/**
* Compare two version strings semantically.
* @returns negative when `left < right`, 0 when equal, positive when greater.
*/
function compareVersions(left, right) {
	const a = parse(left);
	const b = parse(right);
	for (let index = 0; index < 3; index += 1) {
		const x = a.core[index] ?? -1;
		const y = b.core[index] ?? -1;
		if (x !== y) return x < y ? -1 : 1;
	}
	const aRelease = a.pre.length === 0;
	if (aRelease !== (b.pre.length === 0)) return aRelease ? 1 : -1;
	const pre = comparePrerelease(a.pre, b.pre);
	if (pre !== 0) return pre;
	if (!a.conforming || !b.conforming) return a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0;
	return 0;
}
/** Whether `version` satisfies `version >= minimum` under SemVer ordering. */
function atLeast(version, minimum) {
	return compareVersions(version, minimum) >= 0;
}
/** Resolve the DSH home directory exactly as the launcher does. */
function resolveDshHome() {
	const fromEnv = process.env.DSH_HOME;
	if (fromEnv !== void 0 && fromEnv !== "") return fromEnv;
	return join(homedir(), ".dsh");
}
/** Default channel configuration. */
const DEFAULT_CHANNEL_CONFIG = {
	trackedRef: "master",
	originAllowlist: [
		"https://github.com/deepseek-ai/deepseek-harness.git",
		"https://github.com/deepseek-ai/deepseek-harness",
		"git@github.com:deepseek-ai/deepseek-harness.git",
		"git@github.com:deepseek-ai/deepseek-harness"
	],
	npmPackage: DSH_NPM_PACKAGE,
	npmDistTag: "latest",
	incomingLimit: 20,
	dirtyFileLimit: 20
};
/** Normalize one origin URL for allowlist comparison. */
function normalizeOrigin(url) {
	return url.trim().replace(/\.git$/, "").replace(/\/+$/, "");
}
/**
* Whether one origin passes the allowlist.
* @param allowlist - configured allowlist in any spelling.
* @param origin - `git remote get-url origin` output.
*/
function originAllowed(allowlist, origin) {
	const normalized = normalizeOrigin(origin);
	return allowlist.some((entry) => normalizeOrigin(entry) === normalized);
}
/** Read the origin remote URL, or undefined when there is none. */
async function readOrigin(run, gitRoot) {
	const result = await run("git", [
		"remote",
		"get-url",
		"origin"
	], { cwd: gitRoot });
	if (!result.ok) return void 0;
	const url = result.stdout.trim();
	return url === "" ? void 0 : url;
}
/** Count revisions in one `git rev-list --count` range; -1 when the probe fails. */
async function countRange(run, gitRoot, range) {
	const result = await run("git", [
		"rev-list",
		"--count",
		range
	], { cwd: gitRoot });
	if (!result.ok) return -1;
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
async function checkSourceChannel(facts, config, run, fetch) {
	const remoteRef = `origin/${config.trackedRef}`;
	if (facts.gitRoot === void 0) return {
		channel: "source",
		currentSha: "",
		targetSha: "",
		trackedRef: config.trackedRef,
		remoteRef,
		behind: 0,
		ahead: 0,
		upToDate: true,
		dirty: false,
		dirtyFiles: [],
		incoming: [],
		fetched: false,
		error: "no git worktree detected for this installation"
	};
	const gitRoot = facts.gitRoot;
	const state = {
		currentSha: "",
		targetSha: "",
		behind: 0,
		ahead: 0,
		upToDate: true,
		dirty: false,
		dirtyFiles: [],
		incoming: [],
		fetched: false
	};
	const origin = await readOrigin(run, gitRoot);
	if (origin === void 0) return {
		...state,
		channel: "source",
		trackedRef: config.trackedRef,
		remoteRef,
		error: "git remote origin is not configured"
	};
	if (!originAllowed(config.originAllowlist, origin)) return {
		...state,
		channel: "source",
		trackedRef: config.trackedRef,
		remoteRef,
		error: `origin ${origin} is not in the allowlist — refusing to fetch`
	};
	if (fetch) {
		const fetched = await run("git", [
			"fetch",
			"origin",
			config.trackedRef
		], {
			cwd: gitRoot,
			timeoutMs: 12e4
		});
		if (!fetched.ok) return {
			...state,
			channel: "source",
			trackedRef: config.trackedRef,
			remoteRef,
			error: failureOf(fetched, "git fetch failed")
		};
		state.fetched = true;
	}
	const head = await run("git", ["rev-parse", "HEAD"], { cwd: gitRoot });
	if (!head.ok) return {
		...state,
		channel: "source",
		trackedRef: config.trackedRef,
		remoteRef,
		error: failureOf(head, "git rev-parse HEAD failed")
	};
	state.currentSha = head.stdout.trim();
	const target = await run("git", ["rev-parse", remoteRef], { cwd: gitRoot });
	if (!target.ok) return {
		...state,
		channel: "source",
		trackedRef: config.trackedRef,
		remoteRef,
		error: failureOf(target, `git rev-parse ${remoteRef} failed (fetch first)`)
	};
	state.targetSha = target.stdout.trim();
	state.behind = await countRange(run, gitRoot, `HEAD..${remoteRef}`);
	state.ahead = await countRange(run, gitRoot, `${remoteRef}..HEAD`);
	if (state.behind < 0 || state.ahead < 0) return {
		...state,
		channel: "source",
		trackedRef: config.trackedRef,
		remoteRef,
		error: "git rev-list --count failed"
	};
	state.upToDate = state.behind === 0;
	const status = await run("git", ["status", "--porcelain"], { cwd: gitRoot });
	if (status.ok) {
		const lines = status.stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "");
		state.dirty = lines.length > 0;
		state.dirtyFiles = lines.slice(0, config.dirtyFileLimit);
	}
	if (state.behind > 0) {
		const log = await run("git", [
			"log",
			"--oneline",
			"--no-decorate",
			"-n",
			String(config.incomingLimit),
			`HEAD..${remoteRef}`
		], { cwd: gitRoot });
		if (log.ok) {
			const incoming = [];
			for (const line of log.stdout.split("\n")) {
				const match = /^([0-9a-f]{7,40})\s+(.*)$/.exec(line.trim());
				if (match !== null) incoming.push({
					sha: match[1] ?? "",
					subject: match[2] ?? ""
				});
			}
			state.incoming = incoming;
		}
	}
	return {
		...state,
		channel: "source",
		trackedRef: config.trackedRef,
		remoteRef
	};
}
/**
* Probe the registry channel: read the dist-tag and compare versions.
* @param facts - discovered installation facts.
* @param config - channel configuration.
* @param run - command runner.
* @returns the registry-channel comparison row.
*/
async function checkNpmChannel(facts, config, run) {
	const state = {
		installed: facts.version,
		latest: "",
		upToDate: true
	};
	const view = await run("npm", [
		"view",
		config.npmPackage,
		"dist-tags",
		"--json"
	], {
		cwd: process.cwd(),
		timeoutMs: 6e4
	});
	if (!view.ok) return {
		...state,
		channel: "npm",
		distTag: config.npmDistTag,
		error: failureOf(view, `npm view ${config.npmPackage} failed`)
	};
	let parsed;
	try {
		parsed = JSON.parse(view.stdout);
	} catch {
		return {
			...state,
			channel: "npm",
			distTag: config.npmDistTag,
			error: "npm view returned unparsable output"
		};
	}
	const latest = (parsed && typeof parsed === "object" ? parsed : {})[config.npmDistTag];
	if (typeof latest !== "string") return {
		...state,
		channel: "npm",
		distTag: config.npmDistTag,
		error: `dist-tag ${config.npmDistTag} not found for ${config.npmPackage}`
	};
	state.latest = latest;
	state.upToDate = compareVersions(facts.version, latest) >= 0;
	return {
		...state,
		channel: "npm",
		distTag: config.npmDistTag
	};
}
/**
* Run every channel that applies to the installation form.
* @param facts - discovered installation facts.
* @param config - channel configuration.
* @param run - command runner.
* @param fetch - whether the source channel may hit the network.
* @returns the merged, still per-channel, check result.
*/
async function runCheck(facts, config, run, fetch) {
	const result = {
		checkedAt: Date.now(),
		form: facts.form,
		version: facts.version
	};
	if (facts.form === "source") return {
		...result,
		source: await checkSourceChannel(facts, config, run, fetch)
	};
	if (facts.form === "npm") return {
		...result,
		npm: await checkNpmChannel(facts, config, run)
	};
	return result;
}
//#endregion
//#region lib/types/status-file.js
/**
* The upgrade status file: one append-only JSONL record under `$DSH_HOME`.
*
* Every attempt appends timestamped entries (started, per-step outcomes,
* restarted / verified / failed / rolled-back); the retention is bounded so
* the file cannot grow without limit. Any surface's next start reads the tail
* and surfaces the newest non-terminal entry, so a torn upgrade stays visible
* even when nobody was watching the window.
*/
/** Status file name inside the DSH home. */
const STATUS_FILE_NAME = "update-log.jsonl";
/** Absolute status-file path for one home. */
function statusFilePath(home = resolveDshHome()) {
	return join(home, STATUS_FILE_NAME);
}
/** Ensure the home directory exists and append one entry. */
function appendEntry(home, entry) {
	mkdirSync(home, { recursive: true });
	appendFileSync(statusFilePath(home), `${JSON.stringify(entry)}\n`, "utf8");
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
		lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim() !== "");
	} catch {
		return;
	}
	if (lines.length <= 200) return;
	const trimmed = lines.slice(lines.length - 200);
	const temporary = `${path}.tmp`;
	try {
		writeFileSync(temporary, `${trimmed.join("\n")}\n`, "utf8");
		renameSync(temporary, path);
	} catch {}
}
/** Read the most recent entries, oldest first. */
function readEntries(home, limit) {
	const path = statusFilePath(home);
	if (!existsSync(path)) return [];
	let raw;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return [];
	}
	const entries = [];
	for (const line of raw.split("\n")) {
		if (line.trim() === "") continue;
		try {
			entries.push(JSON.parse(line));
		} catch {}
	}
	return entries.slice(Math.max(0, entries.length - limit));
}
/** Event vocabulary that closes an attempt. */
const TERMINAL_EVENTS = /* @__PURE__ */ new Set([
	"restarted",
	"verified",
	"failed",
	"rolled-back",
	"orphaned"
]);
/** Whether one entry closes an upgrade attempt. */
function isTerminal(entry) {
	return TERMINAL_EVENTS.has(entry.event);
}
/**
* Find the newest non-terminal entry for one anchor, if any.
* @returns the entry and its index in the returned tail, or undefined.
*/
function pendingFor(entries, anchor) {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry === void 0) continue;
		if (isTerminal(entry)) return void 0;
		if (entry.anchor === anchor) return {
			entry,
			index
		};
	}
}
/**
* Find the newest entry for one anchor, terminal or not — the reconciliation
* read: a `restarted` closer still owes its `verified` handshake, so the
* newest-for-anchor row, not the newest pending row, decides it.
*/
function lastFor(entries, anchor) {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.anchor === anchor) return entry;
	}
}
//#endregion
//#region lib/types/supervise.js
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
/** Plan file name inside the DSH home. */
const PLAN_FILE_NAME = "update-plan.json";
/** Absolute plan-file path for one home. */
function planFilePath(home = resolveDshHome()) {
	return join(home, PLAN_FILE_NAME);
}
/** Snapshot the current process's launcher invocation. */
function snapshotRestart() {
	return {
		command: process.execPath,
		args: [...process.execArgv, ...process.argv.slice(1)],
		cwd: process.cwd()
	};
}
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
function buildUpgradePlan(facts, config, fromSha, toSha) {
	const pnpmInstall = {
		label: "pnpm install",
		command: "pnpm",
		args: ["install"]
	};
	const build = {
		label: "pnpm run build",
		command: "pnpm",
		args: ["run", "build"]
	};
	return {
		version: 1,
		anchor: facts.gitRoot ?? facts.anchor,
		fromSha,
		toSha,
		trackedRef: config.trackedRef,
		steps: [
			{
				label: `git fetch origin ${config.trackedRef}`,
				command: "git",
				args: [
					"fetch",
					"origin",
					config.trackedRef
				]
			},
			{
				label: "git pull --ff-only",
				command: "git",
				args: ["pull", "--ff-only"]
			},
			pnpmInstall,
			build
		],
		rollback: [
			{
				label: `git reset --hard ${fromSha}`,
				command: "git",
				args: [
					"reset",
					"--hard",
					fromSha
				]
			},
			pnpmInstall,
			build
		],
		restart: snapshotRestart(),
		waitPids: [process.pid],
		waitTimeoutMs: 12e4,
		stepTimeoutMs: 18e5,
		dshHome: resolveDshHome(),
		statusFile: statusFilePath(),
		startedAt: Date.now()
	};
}
/** Write the plan file under the DSH home. */
function writePlan(plan, home = plan.dshHome) {
	mkdirSync(home, { recursive: true });
	const path = planFilePath(home);
	writeFileSync(path, `${JSON.stringify(plan, void 0, 2)}\n`, "utf8");
	return path;
}
/** Locate the built supervisor entry beside this module's artifact. */
function supervisorEntry() {
	return fileURLToPath(new URL("./supervisor.js", import.meta.url));
}
/**
* Spawn the detached supervisor.
*
* Detachment follows the platform rules: a new process group on Unix, a
* detached process on Windows, so the updater survives the host it is
* upgrading. Output goes only to the status file — no controlling terminal is
* assumed to exist by the time steps run.
*/
function spawnSupervisor(planPath) {
	spawn(process.execPath, [supervisorEntry(), planPath], {
		detached: true,
		stdio: "ignore",
		cwd: process.cwd(),
		env: { ...process.env },
		windowsHide: true
	}).unref();
}
/**
* Verify the quiet-tree preconditions before any plan is built: clean worktree
* and an allowlisted origin. Returns a rejection reason, or undefined when
* the tree is ready.
*/
async function preflightSource(facts, config, run) {
	if (facts.gitRoot === void 0) return "this installation is not a git worktree — the source upgrade channel needs a checkout";
	const status = await run("git", ["status", "--porcelain"], { cwd: facts.gitRoot });
	if (!status.ok) return `git status failed: ${status.stderr.trim() !== "" ? status.stderr.trim() : status.stdout.trim()}`;
	const dirty = status.stdout.split("\n").filter((line) => line.trim() !== "");
	if (dirty.length > 0) {
		const files = dirty.slice(0, 5).map((line) => line.trim()).join(", ");
		return `worktree is dirty (${String(dirty.length)} changed path${dirty.length === 1 ? "" : "s"}: ${files}${dirty.length > 5 ? ", …" : ""}) — commit or stash first`;
	}
	const remote = await run("git", [
		"remote",
		"get-url",
		"origin"
	], { cwd: facts.gitRoot });
	if (!remote.ok) return "git remote origin is not configured";
	const origin = remote.stdout.trim();
	if (!originAllowed(config.originAllowlist, origin)) return `origin ${origin} is not in the allowlist — refusing to upgrade`;
}
//#endregion
//#region lib/types/index.js
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
var __runInitializers = function(thisArg, initializers, value) {
	var useValue = arguments.length > 2;
	for (var i = 0; i < initializers.length; i++) value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
	return useValue ? value : void 0;
};
var __esDecorate = function(ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
	function accept(f) {
		if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected");
		return f;
	}
	var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
	var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
	var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
	var _, done = false;
	for (var i = decorators.length - 1; i >= 0; i--) {
		var context = {};
		for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
		for (var p in contextIn.access) context.access[p] = contextIn.access[p];
		context.addInitializer = function(f) {
			if (done) throw new TypeError("Cannot add initializers after decoration has completed");
			extraInitializers.push(accept(f || null));
		};
		var result = (0, decorators[i])(kind === "accessor" ? {
			get: descriptor.get,
			set: descriptor.set
		} : descriptor[key], context);
		if (kind === "accessor") {
			if (result === void 0) continue;
			if (result === null || typeof result !== "object") throw new TypeError("Object expected");
			if (_ = accept(result.get)) descriptor.get = _;
			if (_ = accept(result.set)) descriptor.set = _;
			if (_ = accept(result.init)) initializers.unshift(_);
		} else if (_ = accept(result)) {
			if (kind === "field") initializers.unshift(_);
			else descriptor[key] = _;
		}
	}
	if (target) Object.defineProperty(target, contextIn.name, descriptor);
	done = true;
};
/** Minimum dsh version whose launcher ships the `dsh update` engine. */
const ENGINE_REQUIRED_VERSION = "0.2.0";
/** How many status-file entries the panel's history view reads. */
const HISTORY_LIMIT = 30;
/** Grace between the apply response and this surface's own exit. */
const EXIT_GRACE_MS = 750;
const DEFAULT_PLUGIN_CONFIG = {
	...DEFAULT_CHANNEL_CONFIG,
	historyLimit: HISTORY_LIMIT
};
/** Validate and default the Loader row config; unknown keys are ignored. */
function resolveConfig(raw) {
	const source = raw && typeof raw === "object" ? raw : {};
	const allowlist = Array.isArray(source.originAllowlist) ? source.originAllowlist.filter((entry) => typeof entry === "string") : void 0;
	const count = (value, fallback) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 200 ? value : fallback;
	return {
		trackedRef: typeof source.trackedRef === "string" && source.trackedRef !== "" ? source.trackedRef : DEFAULT_PLUGIN_CONFIG.trackedRef,
		originAllowlist: allowlist ?? DEFAULT_PLUGIN_CONFIG.originAllowlist,
		npmPackage: typeof source.npmPackage === "string" && source.npmPackage !== "" ? source.npmPackage : DEFAULT_PLUGIN_CONFIG.npmPackage,
		npmDistTag: typeof source.npmDistTag === "string" && source.npmDistTag !== "" ? source.npmDistTag : DEFAULT_PLUGIN_CONFIG.npmDistTag,
		incomingLimit: count(source.incomingLimit, DEFAULT_PLUGIN_CONFIG.incomingLimit),
		dirtyFileLimit: count(source.dirtyFileLimit, DEFAULT_PLUGIN_CONFIG.dirtyFileLimit),
		historyLimit: count(source.historyLimit, DEFAULT_PLUGIN_CONFIG.historyLimit)
	};
}
/** Read this plugin's own package version from its manifest. */
function pluginVersion() {
	try {
		const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
		return typeof manifest.version === "string" ? manifest.version : "0.0.0";
	} catch {
		return "0.0.0";
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
			_status_decorators = [Remote("status")];
			_check_decorators = [Remote("check")];
			_apply_decorators = [Remote("apply")];
			__esDecorate(this, null, _status_decorators, {
				kind: "method",
				name: "status",
				static: false,
				private: false,
				access: {
					has: (obj) => "status" in obj,
					get: (obj) => obj.status
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _check_decorators, {
				kind: "method",
				name: "check",
				static: false,
				private: false,
				access: {
					has: (obj) => "check" in obj,
					get: (obj) => obj.check
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			__esDecorate(this, null, _apply_decorators, {
				kind: "method",
				name: "apply",
				static: false,
				private: false,
				access: {
					has: (obj) => "apply" in obj,
					get: (obj) => obj.apply
				},
				metadata: _metadata
			}, null, _instanceExtraInitializers);
			if (_metadata) Object.defineProperty(this, Symbol.metadata, {
				enumerable: true,
				configurable: true,
				writable: true,
				value: _metadata
			});
		}
		config = __runInitializers(this, _instanceExtraInitializers);
		facts;
		runner;
		spawner;
		engineProbe;
		/** Lazily probed engine availability (cached after the first apply). */
		engineAvailable;
		constructor(ctx, config = {}, tools = {}) {
			super(ctx, "update");
			this.config = resolveConfig(config);
			this.facts = tools.facts ?? discoverInstallation();
			this.runner = tools.runner ?? runCommand;
			this.spawner = tools.spawner ?? spawnSupervisor;
			this.engineProbe = tools.engineProbe ?? (() => this.probeEngine());
			this.engineAvailable = void 0;
			this.ctx.logger.info(`dsh-about-plugin: mounted (dsh ${this.facts.version}, form ${this.facts.form}, engine ${atLeast(this.facts.version, "0.2.0") ? "version-sufficient" : `requires >= ${ENGINE_REQUIRED_VERSION}`})`);
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
				dirtyFileLimit: this.config.dirtyFileLimit
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
				if (last === void 0) return;
				if (last.event === "restarted") {
					appendEntry(home, {
						at: Date.now(),
						event: "verified",
						anchor: this.anchor
					});
					return;
				}
				if (isTerminal(last)) return;
				appendEntry(home, {
					at: Date.now(),
					event: "orphaned",
					anchor: this.anchor,
					detail: `previous upgrade attempt is unfinished (last event: ${last.event}${last.detail === void 0 ? "" : ` — ${last.detail}`}); the tree may need manual attention or a git reset`
				});
			} catch {}
		}
		/** Availability rows for both channels under the current form. */
		channelRows() {
			return [this.facts.gitRoot === void 0 ? {
				channel: "source",
				available: false,
				note: "no git worktree detected for this installation"
			} : {
				channel: "source",
				available: true
			}, this.facts.form === "unknown" ? {
				channel: "npm",
				available: false,
				note: "install form unknown — packaged executables own their updates"
			} : {
				channel: "npm",
				available: true
			}];
		}
		/**
		* Probe whether the running launcher ships the `dsh update` engine.
		*
		* The probe runs the launcher's own argument surface (`update --help`
		* exits zero only when the subcommand exists) and is cached per process.
		*/
		async probeEngine() {
			if (this.engineAvailable !== void 0) return this.engineAvailable;
			const entry = process.argv[1];
			if (entry === void 0 || entry === "") {
				this.engineAvailable = false;
				return false;
			}
			const probe = await this.runner(process.execPath, [
				...process.execArgv,
				entry,
				"update",
				"--help"
			], {
				cwd: process.cwd(),
				timeoutMs: 2e4
			});
			this.engineAvailable = probe.ok;
			return probe.ok;
		}
		/** Version facts and history for the panel's at-rest view. */
		async status() {
			return {
				pluginVersion: pluginVersion(),
				dsh: this.facts,
				engine: {
					requiredVersion: ENGINE_REQUIRED_VERSION,
					available: this.engineAvailable ?? null
				},
				channels: this.channelRows(),
				history: readEntries(resolveDshHome(), this.config.historyLimit),
				statusFile: statusFilePath()
			};
		}
		/** Channel-aware update check: per-channel answers, never merged. */
		async check() {
			const fetch = this.facts.form === "source";
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
			const reject = (reason) => ({
				accepted: false,
				mode: "rejected",
				reason,
				statusFile
			});
			if (this.facts.form !== "source" || this.facts.gitRoot === void 0) return reject(`the supervised source upgrade needs a git checkout installation (detected form: ${this.facts.form}); npm installs upgrade through the registry channel and packaged executables own their updates`);
			const preflight = await preflightSource(this.facts, this.channelConfig, this.runner);
			if (preflight !== void 0) return reject(preflight);
			const head = await this.runner("git", ["rev-parse", "HEAD"], { cwd: this.facts.gitRoot });
			if (!head.ok) return reject(`git rev-parse HEAD failed: ${head.stderr.trim() !== "" ? head.stderr.trim() : head.stdout.trim()}`);
			const fromSha = head.stdout.trim();
			const target = await this.runner("git", ["rev-parse", `origin/${this.config.trackedRef}`], { cwd: this.facts.gitRoot });
			if (!target.ok) return reject(`git rev-parse origin/${this.config.trackedRef} failed — run a check first`);
			const toSha = target.stdout.trim();
			if (fromSha === toSha) return reject(`already at the tracked ${this.config.trackedRef} head (${fromSha.slice(0, 12)})`);
			const pending = pendingFor(readEntries(home, 50), this.facts.gitRoot);
			if (pending !== void 0) return reject(`another upgrade attempt is pending (last event: ${pending.entry.event}) — let it finish or inspect ${statusFile}`);
			const origin = await this.runner("git", [
				"remote",
				"get-url",
				"origin"
			], { cwd: this.facts.gitRoot });
			if (!origin.ok || !originAllowed(this.channelConfig.originAllowlist, origin.stdout.trim())) return reject("origin is not in the allowlist — refusing to upgrade");
			if (await this.engineProbe()) {
				const entry = process.argv[1] ?? "dsh";
				const engine = await this.runner(process.execPath, [
					...process.execArgv,
					entry,
					"update",
					"apply",
					"--json"
				], {
					cwd: process.cwd(),
					timeoutMs: 3e4
				});
				if (engine.ok) {
					appendEntry(home, {
						at: Date.now(),
						event: "started",
						anchor: this.facts.gitRoot,
						detail: "delegated to the launcher update engine",
						from: fromSha,
						to: toSha
					});
					return {
						accepted: true,
						mode: "engine",
						fromSha,
						statusFile
					};
				}
				return reject(`the engine rejected the apply: ${engine.stderr.trim() !== "" ? engine.stderr.trim() : engine.stdout.trim()}`);
			}
			const plan = buildUpgradePlan(this.facts, this.channelConfig, fromSha, toSha);
			const planPath = writePlan(plan);
			appendEntry(home, {
				at: Date.now(),
				event: "started",
				anchor: this.facts.gitRoot,
				detail: `supervised upgrade via plugin-local supervisor (${plan.steps.length} steps)`,
				from: fromSha,
				to: toSha
			});
			this.spawner(planPath);
			const exit = this.ctx.get("appExit");
			if (typeof exit === "function") setTimeout(() => {
				try {
					exit();
				} catch {}
			}, EXIT_GRACE_MS).unref();
			return {
				accepted: true,
				mode: "plugin-local",
				fromSha,
				statusFile
			};
		}
	};
})();
//#endregion
export { ENGINE_REQUIRED_VERSION, UpdateGateway, UpdateGateway as default, resolveConfig };
