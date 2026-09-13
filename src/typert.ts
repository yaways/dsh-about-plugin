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

import type { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'
import { applyResultSchema, checkResultSchema, updateStatusSchema } from './schemas.ts'

/** Result type symbol reported by diagnostics for one method. */
const TYPE_SYMBOLS = {
  status: 'dsh-about-plugin/types#UpdateStatus',
  check: 'dsh-about-plugin/types#CheckResult',
  apply: 'dsh-about-plugin/types#ApplyResult',
} as const

type RemoteMethod = keyof typeof TYPE_SYMBOLS

/** Build one direct, parameterless invocation descriptor with a strict result codec. */
function invocation(method: RemoteMethod, schema: z.ZodType): InvocationDescriptor {
  return {
    id: `dsh-about-plugin#update/${method}`,
    service: 'update',
    namespace: 'update',
    method,
    invocation: { kind: 'direct' },
    parameters: [],
    result: { mode: 'strict', typeSymbol: TYPE_SYMBOLS[method], schema },
  }
}

export const TYPERT = {
  package: 'dsh-about-plugin',
  face: 'host',
  schemas: [],
  invocations: [
    invocation('status', updateStatusSchema),
    invocation('check', checkResultSchema),
    invocation('apply', applyResultSchema),
  ],
  model: { services: [], events: [], objects: [] },
} as const

export default TYPERT
