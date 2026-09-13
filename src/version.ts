/**
 * Version comparison and home-directory resolution helpers.
 *
 * A compact prerelease-aware SemVer comparator (major.minor.patch with
 * dotted numeric prerelease identifiers, the shape every dsh release uses)
 * instead of a dependency: the plugin keeps its runtime footprint at zod
 * alone. Non-conforming versions compare by string order after the numeric
 * fields, which is only a diagnostics path — version gates never reject on
 * parse shape, they report.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** One prerelease identifier: numeric, alphanumeric, or absent (end of run). */
type Identifier = number | string | null

/** One parsed release identifier run. */
type Prerelease = readonly Identifier[]

/** One parsed release: numeric core, prerelease identifier run, conformance flag. */
interface Parsed {
  readonly core: readonly number[]
  readonly pre: Prerelease
  readonly raw: string
  readonly conforming: boolean
}

/** Parse `x.y.z[-pre[.n]…]` into comparable fields. */
function parse(version: string): Parsed {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (match === null) {
    return { core: [-1, -1, -1], pre: [], raw: version, conforming: false }
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  const pre: Identifier[] = []
  if (match[4] !== undefined) {
    for (const part of match[4].split('.')) {
      pre.push(/^\d+$/.test(part) ? Number(part) : part)
    }
  }
  return { core, pre, raw: version, conforming: true }
}

/** Compare two identifiers per SemVer: numeric < alphanumeric, lexical within. */
function compareIdentifier(left: Identifier, right: Identifier): number {
  // Absent (end of a shorter run) is lower than any present identifier.
  if (left === null || right === null) return left === right ? 0 : left === null ? -1 : 1
  if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : left > right ? 1 : 0
  if (typeof left === 'number') return -1
  if (typeof right === 'number') return 1
  return left < right ? -1 : left > right ? 1 : 0
}

/** Compare two prerelease identifier runs per SemVer: shorter is lower when equal so far. */
function comparePrerelease(left: Prerelease, right: Prerelease): number {
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const order = compareIdentifier(left[index] ?? null, right[index] ?? null)
    if (order !== 0) return order
  }
  return 0
}

/**
 * Compare two version strings semantically.
 * @returns negative when `left < right`, 0 when equal, positive when greater.
 */
export function compareVersions(left: string, right: string): number {
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    const x = a.core[index] ?? -1
    const y = b.core[index] ?? -1
    if (x !== y) return x < y ? -1 : 1
  }
  // SemVer: at the same core, a release outranks any prerelease of it.
  const aRelease = a.pre.length === 0
  const bRelease = b.pre.length === 0
  if (aRelease !== bRelease) return aRelease ? 1 : -1
  const pre = comparePrerelease(a.pre, b.pre)
  if (pre !== 0) return pre
  if (!a.conforming || !b.conforming) {
    // Non-conforming spellings (build suffixes, arbitrary text) fall back to
    // raw string order for stability; conforming equal versions are equal.
    return a.raw < b.raw ? -1 : a.raw > b.raw ? 1 : 0
  }
  return 0
}

/** Resolve the DSH home directory exactly as the launcher does. */
export function resolveDshHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv
  return join(homedir(), '.dsh')
}
