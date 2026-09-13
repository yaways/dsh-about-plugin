/**
 * Wire-schema acceptance: the host methods' return shapes must parse against
 * the strict codecs both Typert faces register — the gateway validates every
 * `update/*` result through the host artifact, so a drift between the service
 * code and this schema is a runtime RPC failure, caught here instead.
 */

import { describe, expect, it } from 'vitest'
import { applyResultSchema, checkResultSchema, updateStatusSchema } from '../src/schemas.ts'

/** The exact object UpdateGateway.status() builds. */
function statusPayload(): object {
  return {
    pluginVersion: '0.1.0',
    dsh: {
      version: '0.1.5-rc.2',
      anchor: '/checkout/apps/cli',
      form: 'source',
      gitRoot: '/checkout',
    },
    engine: { requiredVersion: '0.2.0', available: null },
    channels: [
      { channel: 'source', available: true },
      { channel: 'npm', available: false, note: 'install form unknown' },
    ],
    history: [
      { at: 1, event: 'started', anchor: '/checkout', from: 'aaaa', to: 'bbbb' },
      { at: 2, event: 'verified', detail: 'ok' },
    ],
    statusFile: '/home/.dsh/update-log.jsonl',
  }
}

describe('updateStatusSchema', () => {
  it('accepts the status() return shape', () => {
    expect(() => updateStatusSchema.parse(statusPayload())).not.toThrow()
  })

  it('accepts an npm form without gitRoot', () => {
    const payload = statusPayload() as Record<string, unknown>
    const dsh = payload.dsh as Record<string, unknown>
    delete dsh.gitRoot
    dsh.form = 'npm'
    expect(() => updateStatusSchema.parse(payload)).not.toThrow()
  })

  it('rejects an unknown install form', () => {
    const payload = statusPayload() as Record<string, unknown>
    ;(payload.dsh as Record<string, unknown>).form = 'brew'
    expect(() => updateStatusSchema.parse(payload)).toThrow()
  })

  it('rejects a missing required field', () => {
    const payload = statusPayload() as Record<string, unknown>
    delete payload.statusFile
    expect(() => updateStatusSchema.parse(payload)).toThrow()
  })
})

describe('checkResultSchema', () => {
  it('accepts a source-channel result', () => {
    const payload = {
      checkedAt: 123,
      form: 'source',
      version: '0.1.5-rc.2',
      source: {
        channel: 'source',
        currentSha: 'aaaa',
        targetSha: 'bbbb',
        trackedRef: 'master',
        remoteRef: 'origin/master',
        behind: 2,
        ahead: 0,
        upToDate: false,
        dirty: true,
        dirtyFiles: ['M a.ts'],
        incoming: [{ sha: 'bbbb', subject: 'fix' }],
        fetched: true,
      },
    }
    expect(() => checkResultSchema.parse(payload)).not.toThrow()
  })

  it('accepts a source result carrying an error', () => {
    const payload = {
      checkedAt: 123,
      form: 'source',
      version: '0.1.5-rc.2',
      source: {
        channel: 'source',
        currentSha: '',
        targetSha: '',
        trackedRef: 'master',
        remoteRef: 'origin/master',
        behind: 0,
        ahead: 0,
        upToDate: true,
        dirty: false,
        dirtyFiles: [],
        incoming: [],
        fetched: false,
        error: 'git fetch failed',
      },
    }
    expect(() => checkResultSchema.parse(payload)).not.toThrow()
  })

  it('accepts an npm-channel result', () => {
    const payload = {
      checkedAt: 123,
      form: 'npm',
      version: '0.1.4',
      npm: { channel: 'npm', installed: '0.1.4', latest: '0.2.0', distTag: 'latest', upToDate: false },
    }
    expect(() => checkResultSchema.parse(payload)).not.toThrow()
  })

  it('accepts an unknown form with neither channel', () => {
    expect(() => checkResultSchema.parse({ checkedAt: 1, form: 'unknown', version: '0.0.0' })).not.toThrow()
  })

  it('rejects a negative behind count', () => {
    const payload = {
      checkedAt: 1,
      form: 'source',
      version: '0',
      source: {
        channel: 'source', currentSha: '', targetSha: '', trackedRef: 'master', remoteRef: 'origin/master',
        behind: -1, ahead: 0, upToDate: true, dirty: false, dirtyFiles: [], incoming: [], fetched: false,
      },
    }
    expect(() => checkResultSchema.parse(payload)).toThrow()
  })
})

describe('applyResultSchema', () => {
  it('accepts an accepted plugin-local result', () => {
    expect(() => applyResultSchema.parse({
      accepted: true, mode: 'plugin-local', fromSha: 'aaaa', statusFile: '/x/update-log.jsonl',
    })).not.toThrow()
  })

  it('accepts an engine-delegated result', () => {
    expect(() => applyResultSchema.parse({
      accepted: true, mode: 'engine', fromSha: 'aaaa', statusFile: '/x/update-log.jsonl',
    })).not.toThrow()
  })

  it('accepts a rejection with its reason', () => {
    expect(() => applyResultSchema.parse({
      accepted: false, mode: 'rejected', reason: 'dirty', statusFile: '/x/update-log.jsonl',
    })).not.toThrow()
  })

  it('rejects an unknown mode', () => {
    expect(() => applyResultSchema.parse({
      accepted: true, mode: 'magic', statusFile: '/x/update-log.jsonl',
    })).toThrow()
  })
})
