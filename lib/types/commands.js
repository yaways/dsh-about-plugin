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
import { spawn } from 'node:child_process';
/** Cap captured output so a misbehaving command cannot exhaust memory. */
const MAX_CAPTURE_BYTES = 512 * 1024;
/** Run one command to completion, killing it on timeout. */
export const runCommand = (command, args, options) => new Promise((resolve) => {
    const child = spawn(command, args, {
        cwd: options.cwd,
        // Windows resolves pnpm (and sometimes git) through .cmd shims, which
        // shell-less spawn refuses since the CVE-2024-27980 hardening.
        shell: process.platform === 'win32',
        env: { ...process.env, ...options.env },
        windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const capture = (side) => (chunk) => {
        const text = chunk.toString('utf8');
        if (side === 'out') {
            if (stdout.length < MAX_CAPTURE_BYTES)
                stdout += text;
        }
        else if (stderr.length < MAX_CAPTURE_BYTES) {
            stderr += text;
        }
    };
    child.stdout?.on('data', capture('out'));
    child.stderr?.on('data', capture('err'));
    const timeout = setTimeout(() => {
        if (settled)
            return;
        settled = true;
        child.kill();
        resolve({ ok: false, code: -1, stdout, stderr: `${stderr}\n[dsh-about-plugin] timed out after ${String(options.timeoutMs ?? 60_000)}ms` });
    }, options.timeoutMs ?? 60_000);
    const finish = (ok, code) => {
        if (settled)
            return;
        settled = true;
        clearTimeout(timeout);
        resolve({ ok, code, stdout, stderr });
    };
    child.on('error', error => {
        stderr += `\n${String(error)}`;
        finish(false, -1);
    });
    child.on('close', code => finish(code === 0, code ?? -1));
});
/** Failure text for a rejected command, trimmed for display. */
export function failureOf(result, what) {
    const detail = result.stderr.trim() !== '' ? result.stderr.trim() : result.stdout.trim();
    return detail !== '' ? `${what}: ${detail}` : `${what} (exit ${String(result.code)})`;
}
//# sourceMappingURL=commands.js.map