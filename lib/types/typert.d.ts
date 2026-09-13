/**
 * Host-face Typert artifact for the `update` Remote namespace.
 *
 * Hand-written to the exact shape `dsh-typert-generator` emits for in-tree
 * packages (compare `@deepseek-ai/dsh-host-plugin-inventory`'s generated
 * `lib/typert.host.js`): a `TYPERT` manifest with an empty reflection model
 * and one invocation descriptor per `@Remote` method. `dsh-typert-loader`
 * imports this through the package's `./typert` export whenever the plugin's
 * Loader entry is mounted, registering strict gateway validation for every
 * `update/*` endpoint. Do not rename methods here without renaming the
 * decorated methods on `UpdateGateway` in `src/index.ts`.
 */
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
export declare const TYPERT: {
    readonly package: "dsh-about-plugin";
    readonly face: "host";
    readonly schemas: readonly [];
    readonly invocations: readonly [InvocationDescriptor, InvocationDescriptor, InvocationDescriptor];
    readonly model: {
        readonly services: readonly [];
        readonly events: readonly [];
        readonly objects: readonly [];
    };
};
export default TYPERT;
//# sourceMappingURL=typert.d.ts.map