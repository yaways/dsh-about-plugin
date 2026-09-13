/** Status file journaling: append, read, retention, pending detection. */

import { appendFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  RETAINED_ENTRIES, appendEntry, isTerminal, pendingFor, readEntries, statusFilePath,
} from '../src/status-file.ts'
import type { HistoryEntry } from '../src/schemas.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-about-status-'))
  tempDirs.push(dir)
  return dir
}

function entry(at: number, event: HistoryEntry['event'], anchor = '/checkout'): HistoryEntry {
  return { at, event, anchor }
}

describe('appendEntry / readEntries', () => {
  it('round-trips entries oldest-first', () => {
    const dir = home()
    appendEntry(dir, entry(1, 'started'))
    appendEntry(dir, entry(2, 'step-ok', '/other'))
    appendEntry(dir, entry(3, 'restarted'))
    const read = readEntries(dir, 10)
    expect(read.map(item => item.event)).toEqual(['started', 'step-ok', 'restarted'])
    expect(readEntries(dir, 2).map(item => item.event)).toEqual(['step-ok', 'restarted'])
  })

  it('returns empty for a missing file', () => {
    expect(readEntries(home(), 10)).toEqual([])
  })

  it('retains only the newest RETAINED_ENTRIES rows', () => {
    const dir = home()
    for (let index = 0; index < RETAINED_ENTRIES + 25; index += 1) {
      appendEntry(dir, entry(index, 'step-ok'))
    }
    const read = readEntries(dir, RETAINED_ENTRIES + 100)
    expect(read).toHaveLength(RETAINED_ENTRIES)
    expect(read[0]?.at).toBe(25)
    expect(read.at(-1)?.at).toBe(RETAINED_ENTRIES + 24)
  })

  it('skips a torn final line without failing', () => {
    const dir = home()
    appendEntry(dir, entry(1, 'started'))
    appendFileSync(statusFilePath(dir), '{"at":2,"event":"step-ok"  /* torn', 'utf8')
    const read = readEntries(dir, 10)
    expect(read).toHaveLength(1)
  })
})

describe('isTerminal / pendingFor', () => {
  it('classifies terminal events', () => {
    for (const event of ['restarted', 'verified', 'failed', 'rolled-back', 'orphaned'] as const) {
      expect(isTerminal(entry(0, event))).toBe(true)
    }
    for (const event of ['started', 'step-ok', 'step-failed'] as const) {
      expect(isTerminal(entry(0, event))).toBe(false)
    }
  })

  it('finds the newest non-terminal entry for one anchor', () => {
    const entries = [
      entry(1, 'started'),
      entry(2, 'step-ok'),
      entry(3, 'verified'),
      entry(4, 'started'),
      entry(5, 'step-ok'),
    ]
    const pending = pendingFor(entries, '/checkout')
    expect(pending?.entry.at).toBe(5)
  })

  it('returns undefined once a terminal entry closes the attempt', () => {
    const entries = [entry(1, 'started'), entry(2, 'failed')]
    expect(pendingFor(entries, '/checkout')).toBeUndefined()
  })

  it('ignores other anchors', () => {
    const entries = [entry(1, 'started', '/elsewhere')]
    expect(pendingFor(entries, '/checkout')).toBeUndefined()
  })
})
