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
import TYPERT_REMOTE from "../remote.js";
import { AboutSection } from "./AboutSection.js";
import { en, zh } from "./locales.js";
import { ensurePanelStyles } from "./styles.js";
/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.about';
/** Services required before activation (the update namespace joins dynamically after the mount). */
export const inject = ['slots', 'locale', 'remote'];
/** Unwrap one RemoteResult into a thrown Error or its value. */
async function unwrap(promise) {
    const result = await promise;
    if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    return result.value;
}
/**
 * Register the section from a context that may read the mounted namespace.
 * @param ctx - child context injecting `remote.update` (and the parent's base services).
 */
function registerUi(ctx) {
    const t = ctx.locale.bind(NS);
    const face = () => ({
        status: () => unwrap(ctx.remote.update.status()),
        check: () => unwrap(ctx.remote.update.check()),
        apply: () => unwrap(ctx.remote.update.apply()),
    });
    ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'about',
        order: 100,
        label: () => t('nav'),
        locale: NS,
        inject: face,
    }, AboutSection));
}
/**
 * Register the dictionaries, mount the `update` remote namespace, and
 * contribute the About section to the Settings dialog.
 * @param ctx - client root context.
 * @returns disposer unmounting the UI registration and the Remote namespace.
 */
export async function apply(ctx) {
    ensurePanelStyles();
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-about-plugin: dictionaries');
    // 1. Mount the namespace: this creates the `remote.update` service.
    const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE);
    // 2. Open a context that injects it (now that it exists) and register the
    //    section from there; the child parks until the service is up.
    const ui = ctx.inject(['remote.update'], registerUi);
    try {
        await ui;
    }
    catch (error) {
        await ui.dispose();
        await disposeRemote();
        throw error;
    }
    return async () => {
        await ui.dispose();
        await disposeRemote();
    };
}
//# sourceMappingURL=index.js.map