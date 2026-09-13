import { spawn } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
//#region lib/types/supervisor/main.js
/**
* Detached upgrade supervisor.
*
* Invoked as `node lib/supervisor.js <plan-file>` by the plugin's apply path,
* this script is the one permitted exception to the timing rule that the
* source tree and `node_modules` are never mutated under a live process: it
* is a single self-contained file (only Node builtins — it must not import
* anything from the tree it is about to rewrite), it waits for every recorded
* pid to exit before touching anything, and every command it runs comes from
* the fixed vocabulary the plan recorded. On any step failure it restores the
* recorded commit, reinstalls, rebuilds, restarts, and records the rollback.
*
* Output goes exclusively to the status file — by the time steps run there is
* no controlling terminal to talk to.
*/
/** Append one status entry. */
function record(plan, event, detail, extra) {
	const entry = {
		at: Date.now(),
		event,
		...detail === void 0 ? {} : { detail },
		anchor: plan.anchor,
		from: plan.fromSha,
		to: plan.toSha,
		...extra
	};
	try {
		appendFileSync(plan.statusFile, `${JSON.stringify(entry)}\n`, "utf8");
	} catch {}
}
/** Whether one pid is still alive: signal-0 probe where EPERM reads as alive. */
function pidAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}
/** Wait until every recorded pid exits, or the bound passes. */
async function waitForQuiet(plan) {
	const deadline = Date.now() + plan.waitTimeoutMs;
	for (;;) {
		if (plan.waitPids.filter((pid) => pidAlive(pid)).length === 0) return true;
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
}
/** Run one step to completion under its bound. */
function runStep(plan, step) {
	return new Promise((resolve) => {
		const child = spawn(step.command, step.args, {
			cwd: plan.anchor,
			shell: process.platform === "win32",
			env: { ...process.env },
			windowsHide: true
		});
		let output = "";
		const capture = (chunk) => {
			if (output.length < 65536) output += chunk.toString("utf8");
		};
		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		let settled = false;
		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			resolve({
				ok: false,
				output: `${output}\n[supervisor] step timed out`
			});
		}, plan.stepTimeoutMs);
		const finish = (ok) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({
				ok,
				output
			});
		};
		child.on("error", (error) => {
			output += `\n${String(error)}`;
			finish(false);
		});
		child.on("close", (code) => finish(code === 0));
	});
}
/** Run a recorded command list, recording each outcome. */
async function runSequence(plan, steps, phase) {
	for (const step of steps) {
		const result = await runStep(plan, step);
		const tail = result.output.trim().split("\n").slice(-3).join(" | ").slice(0, 400);
		if (!result.ok) {
			record(plan, "step-failed", `${phase}: ${step.label}${tail !== "" ? ` — ${tail}` : ""}`);
			return false;
		}
		record(plan, "step-ok", `${phase}: ${step.label}`);
	}
	return true;
}
/** Restart the recorded launcher invocation, detached like this supervisor. */
function restart(plan) {
	spawn(plan.restart.command, plan.restart.args, {
		cwd: plan.restart.cwd,
		detached: true,
		stdio: "ignore",
		env: { ...process.env },
		windowsHide: true
	}).unref();
}
/** Main sequence: wait, upgrade, restart — or roll back and restart. */
async function main() {
	const planPath = process.argv[2];
	if (planPath === void 0 || planPath === "") {
		process.stderr.write("supervisor: no plan file given\n");
		process.exit(2);
	}
	let plan;
	try {
		plan = JSON.parse(readFileSync(planPath, "utf8"));
	} catch (error) {
		process.stderr.write(`supervisor: cannot read plan ${planPath}: ${String(error)}\n`);
		process.exit(2);
	}
	if (plan.version !== 1) {
		process.stderr.write(`supervisor: unsupported plan version ${String(plan.version)}\n`);
		process.exit(2);
	}
	if (!await waitForQuiet(plan)) {
		const still = plan.waitPids.filter((pid) => pidAlive(pid)).join(", ");
		record(plan, "failed", `live surfaces did not exit within ${String(plan.waitTimeoutMs)}ms (pids still alive: ${still !== "" ? still : "none"}); nothing was changed`);
		process.exit(1);
	}
	record(plan, "step-ok", "tree quiet — recorded pids exited");
	if (await runSequence(plan, plan.steps, "step")) {
		restart(plan);
		record(plan, "restarted", `upgraded ${plan.fromSha.slice(0, 12)} → ${plan.toSha.slice(0, 12)}`);
		return;
	}
	record(plan, "step-failed", "upgrade failed — rolling back to the recorded commit");
	const restored = await runSequence(plan, plan.rollback, "rollback");
	restart(plan);
	record(plan, restored ? "rolled-back" : "failed", restored ? `restored ${plan.fromSha.slice(0, 12)} after a failed upgrade` : `rollback also failed — the tree may need manual git attention (recorded SHA: ${plan.fromSha})`);
}
main().catch((error) => {
	process.stderr.write(`supervisor: unexpected failure: ${String(error)}\n`);
	process.exit(1);
});
//#endregion
export {};
