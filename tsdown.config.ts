/**
 * Build configuration for dsh-about-plugin.
 *
 * The build runs in two passes, mirroring the repository's own pipeline:
 * tsc first emits JavaScript AND declarations into `lib/types` — that pass
 * also downlevels the standard decorators (`@Remote`) through
 * `__esDecorate`, which Node cannot parse raw — and tsdown then bundles the
 * emitted JavaScript. Five single-entry artifacts, one output file each (a
 * multi-entry build would emit hash-named shared chunks the exact `files`
 * list cannot publish):
 *
 *   lib/index.js      Host plugin (the Cordis entry the Loader row imports)
 *   lib/typert.js     Host-face Typert artifact (registered by dsh-typert-loader)
 *   lib/remote.js     Client-face Typert artifact (mounted by this plugin's own
 *                     browser half through ctx.remote.$mount())
 *   lib/supervisor.js Detached upgrade supervisor — zero imports beyond Node
 *                     builtins, because it runs while the tree it upgrades is
 *                     being rewritten
 *   lib/client.js     Browser bundle in the closure-factory format the DSH
 *                     module table loads: window.__ModuleLoader__.load(...)
 *
 * The Host artifacts keep runtime dependencies (zod) and every
 * @deepseek-ai/* peer external — a real install resolves them through the
 * profile module fallback. The browser bundle inlines everything except the
 * frozen platform module table (React, Cordis, static UI libraries), exactly
 * like an in-tree client plugin package (see the repository's
 * packages/client/tsdown.client.ts preset this mirrors).
 */
import { isBuiltin } from 'node:module'
import type { UserConfig } from 'tsdown'

/**
 * The module-table baseline the web shell shares into every dynamic bundle
 * (packages/client/web/src/platform.ts PLATFORM_MODULES). Requested
 * specifiers stay external; everything else inlines.
 */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/**
 * Production sections of this package's manifest: what a real install
 * materializes on disk. Stated explicitly (rather than left to tsdown's
 * fallback) so moving a dependency between npm sections cannot silently
 * re-bundle it.
 */
const PRODUCTION_EXTERNALS = [
  /^zod(\/|$)/,
  /^@deepseek-ai\/cordis(\/|$)/,
  /^@deepseek-ai\/dsh-typert-protocol(\/|$)/,
]

/** Whether one import specifier names a production dependency (subpaths included). */
const isProductionDependency = (specifier: string): boolean =>
  PRODUCTION_EXTERNALS.some(pattern => pattern.test(specifier))

/** Shared options for the four Node-side artifacts. */
const node: Pick<UserConfig, 'format' | 'platform' | 'target' | 'dts' | 'clean' | 'outDir' | 'deps' | 'fixedExtension'> = {
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  // The package is "type": "module", so the natural ESM extension is .js —
  // fixedExtension would force .mjs and break the exports map.
  fixedExtension: false,
  dts: false,
  clean: false,
  outDir: 'lib',
  deps: {
    neverBundle: isProductionDependency,
    alwaysBundle: (specifier: string) => !isBuiltin(specifier) && !isProductionDependency(specifier),
  },
}

const hostIndex: UserConfig = {
  ...node,
  name: 'dsh-about-plugin',
  entry: { index: 'lib/types/index.js' },
}

const hostTypert: UserConfig = {
  ...node,
  name: 'dsh-about-plugin/typert',
  entry: { typert: 'lib/types/typert.js' },
}

const clientTypert: UserConfig = {
  ...node,
  name: 'dsh-about-plugin/remote',
  entry: { remote: 'lib/types/remote.js' },
}

const supervisor: UserConfig = {
  ...node,
  name: 'dsh-about-plugin/supervisor',
  entry: { supervisor: 'lib/types/supervisor/main.js' },
}

/** Whether one import specifier is answered by the browser module table. */
const isRequested = (specifier: string): boolean => PLATFORM_MODULES.has(specifier)

const client: UserConfig = {
  name: 'dsh-about-plugin/client',
  entry: { client: 'lib/types/client/index.js' },
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  clean: false,
  sourcemap: true,
  deps: {
    // The frozen module-table baseline stays external; everything else
    // (zod, the plugin's own remote artifact, its styles) inlines. A
    // require() the table cannot answer is a guaranteed runtime throw.
    neverBundle: isRequested,
    alwaysBundle: (specifier: string) => !isRequested(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: [
        (process.env.NODE_ENV ?? 'production') === 'development' ? 'development' : 'production',
        'browser', 'import', 'module', 'default',
      ],
    },
  },
  // Inlined node-idiom libraries may probe process.env/import.meta.env; bake
  // the build flavor in so the factory cannot throw at boot.
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [{
    // Build-time mirror of the module-edge rules: baseline rows stay
    // external, and every other @deepseek-ai/* value import is an error —
    // either it would inline a duplicate runtime instance or the module
    // table cannot answer it for this package. Type-only imports are erased
    // and never reach this gate.
    name: 'dsh-about-plugin/client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isRequested(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not a module-table external — cross-plugin value imports are forbidden; `
        + 'collaborate through cordis services instead (type-only imports are erased)',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: 'dsh-about-plugin', factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [hostIndex, hostTypert, clientTypert, supervisor, client]
