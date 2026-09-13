/** Version comparison and home resolution. */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { atLeast, compareVersions, resolveDshHome } from '../src/version.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('compareVersions', () => {
  it('orders core fields', () => {
    expect(compareVersions('0.1.9', '0.2.0')).toBeLessThan(0)
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
  })

  it('treats equal versions as equal', () => {
    expect(compareVersions('0.1.5-rc.2', '0.1.5-rc.2')).toBe(0)
    expect(compareVersions('0.1.5', '0.1.5')).toBe(0)
  })

  it('ranks a prerelease below its release', () => {
    expect(compareVersions('0.1.5-rc.2', '0.1.5')).toBeLessThan(0)
    expect(compareVersions('0.1.5', '0.1.5-rc.2')).toBeGreaterThan(0)
  })

  it('orders prerelease identifiers numerically, not lexically', () => {
    expect(compareVersions('0.1.5-rc.2', '0.1.5-rc.10')).toBeLessThan(0)
    expect(compareVersions('0.2.0-beta.1', '0.2.0-rc.1')).toBeLessThan(0)
  })

  it('orders a longer prerelease run above a prefix of it', () => {
    expect(compareVersions('0.1.5-rc', '0.1.5-rc.1')).toBeLessThan(0)
  })

  it('accepts a leading v and tolerates non-conforming strings', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0)
    expect(compareVersions('not-a-version', 'not-a-version')).toBe(0)
    // Non-conforming spellings fall to raw string order; both directions stay stable.
    expect(compareVersions('banana', 'apple')).toBeGreaterThan(0)
  })
})

describe('atLeast', () => {
  it('gates on the minimum', () => {
    expect(atLeast('0.2.0', '0.2.0')).toBe(true)
    expect(atLeast('0.2.1-rc.1', '0.2.0')).toBe(true)
    expect(atLeast('0.1.5-rc.2', '0.2.0')).toBe(false)
  })
})

describe('resolveDshHome', () => {
  it('prefers DSH_HOME', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-about-home-'))
    tempDirs.push(dir)
    process.env.DSH_HOME = dir
    try {
      expect(resolveDshHome()).toBe(dir)
    } finally {
      delete process.env.DSH_HOME
    }
  })

  it('falls back to ~/.dsh', () => {
    const previous = process.env.DSH_HOME
    delete process.env.DSH_HOME
    try {
      expect(resolveDshHome().endsWith('.dsh')).toBe(true)
    } finally {
      if (previous !== undefined) process.env.DSH_HOME = previous
    }
  })
})
