/**
 * Browser half of dsh-about-plugin: the Settings「关于」section.
 *
 * Follows the agent-team mount pattern for a plugin that mounts its OWN
 * remote contribution: the top-level inject names only the base services
 * (`remote`, `locale`, `slots`); `apply` first mounts the plugin's own
 * generated-shaped `update` namespace through `ctx.remote.$mount()`, and only
 * then — with the namespace service in existence — opens a child context that
 * injects `remote.update` and registers the UI from it. (The namespace cannot
 * sit in the static inject list: it is this plugin's own mount that creates
 * it, so a static dependency would park the plugin on itself forever.)
 *
 * The section contributes one `settings.section` entry (id `about`, order 100
 * — the nav bottom). Copy freshness is framework-owned: the nav label is a
 * thunk, and the framework-injected `t` seat follows locale switches without
 * re-registration.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type AboutLocaleKey } from './locales.ts';
export type { AboutSectionInjected, AboutSectionProps } from './AboutSection.tsx';
export type { AboutLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** About-panel copy. */
        'settings.about': AboutLocaleKey;
    }
}
/** Dictionary namespace owned by this plugin. */
export declare const NS = "settings.about";
/** Services required before activation (the update namespace joins dynamically after the mount). */
export declare const inject: string[];
/**
 * Register the dictionaries, mount the `update` remote namespace, and
 * contribute the About section to the Settings dialog.
 * @param ctx - client root context.
 * @returns disposer unmounting the UI registration and the Remote namespace.
 */
export declare function apply(ctx: ClientContext): Promise<() => Promise<void>>;
//# sourceMappingURL=index.d.ts.map