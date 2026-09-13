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
export {};
//# sourceMappingURL=main.d.ts.map