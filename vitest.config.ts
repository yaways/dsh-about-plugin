/**
 * Test configuration.
 *
 * Node-side suites run in the default environment against the real linked
 * workspace packages (cordis, typert-protocol — the prepare script's links).
 * The About-section suite runs under jsdom with the platform UI primitives
 * aliased to a local stub: the real library ships as a browser closure
 * factory that needs the DSH module loader, which a vitest page does not
 * have. The stub keeps the component's state-machine and copy contract under
 * test; the real rendering is verified against a live server.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(new URL('./tests/stubs/ui-primitives.tsx', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
