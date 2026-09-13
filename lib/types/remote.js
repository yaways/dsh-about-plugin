/**
 * Client-face Typert artifact for the `update` Remote namespace.
 *
 * Hand-written to the shape `dsh-typert-generator` emits into generated
 * `typert.remote-client.js` artifacts: a `TYPERT_REMOTE` contribution whose
 * descriptors the browser mounts through `ctx.remote.$mount()`. This plugin's
 * own browser half imports this module (the build inlines it into the client
 * bundle together with zod, like every non-shared client dependency) and
 * mounts it, so the `update` namespace needs no change in `@deepseek-ai/dsh-api-remotes`.
 *
 * The `declare module` merges below give `ctx.remote.update` its typed call
 * face in programs that import this module — the same mechanism the generated
 * artifacts use.
 */
import { applyResultSchema, checkResultSchema, updateStatusSchema } from "./schemas.js";
const TYPE_SYMBOLS = {
    status: 'dsh-about-plugin/types#UpdateStatus',
    check: 'dsh-about-plugin/types#CheckResult',
    apply: 'dsh-about-plugin/types#ApplyResult',
};
function descriptor(method, schema) {
    return {
        id: `dsh-about-plugin#update/${method}`,
        service: 'update',
        namespace: 'update',
        method,
        invocation: { kind: 'direct' },
        parameters: [],
        result: { mode: 'strict', typeSymbol: TYPE_SYMBOLS[method], schema },
    };
}
export const TYPERT_REMOTE = {
    package: 'dsh-about-plugin',
    descriptors: [
        descriptor('status', updateStatusSchema),
        descriptor('check', checkResultSchema),
        descriptor('apply', applyResultSchema),
    ],
};
export default TYPERT_REMOTE;
//# sourceMappingURL=remote.js.map