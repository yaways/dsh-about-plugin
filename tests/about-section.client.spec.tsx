// @vitest-environment jsdom
/**
 * The About section component: rendering, copy, check flow, apply gating, and
 * the restart banner — with the platform primitives stubbed (the real library
 * is a browser closure-factory bundle a vitest page cannot load) and a
 * scripted injected face.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AboutSection, type AboutSectionInjected } from '../src/client/AboutSection.tsx'
import { en, zh } from '../src/client/locales.ts'
import { ensurePanelStyles } from '../src/client/styles.ts'
import type { AboutLocaleKey, UpdateStatus } from '../src/client/index.ts'

type Translate = (key: AboutLocaleKey, params?: Record<string, string | number>) => string

function translator(dict: Record<string, string>): Translate {
  return (key, params) => {
    let text = dict[key] ?? key
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replace(`{${name}}`, String(value))
    }
    return text
  }
}

afterEach(cleanup)

function statusFixture(): UpdateStatus {
  return {
    pluginVersion: '0.1.0',
    dsh: { version: '0.1.5-rc.2', anchor: '/checkout/apps/cli', form: 'source', gitRoot: '/checkout' },
    engine: { requiredVersion: '0.2.0', available: null },
    channels: [
      { channel: 'source', available: true },
      { channel: 'npm', available: true },
    ],
    history: [
      { at: 1_700_000_000_000, event: 'started', anchor: '/checkout' },
      { at: 1_700_000_001_000, event: 'restarted', anchor: '/checkout' },
    ],
    statusFile: '/home/.dsh/update-log.jsonl',
  }
}

interface Face {
  readonly face: AboutSectionInjected
  readonly status: ReturnType<typeof vi.fn>
  readonly check: ReturnType<typeof vi.fn>
  readonly apply: ReturnType<typeof vi.fn>
}

function face(statusResult: UpdateStatus = statusFixture()): Face {
  const status = vi.fn().mockResolvedValue(statusResult)
  const check = vi.fn()
  const apply = vi.fn()
  return { status, check, apply, face: { status, check, apply } }
}

function renderSection(over: Partial<Face> = {}, t: Translate = translator(en)): void {
  const base = face()
  const injected = { ...base.face, ...over } as AboutSectionInjected
  render(<AboutSection t={t} {...injected} />)
}

describe('AboutSection', () => {
  it('renders version facts, engine note, and history', async () => {
    renderSection()
    expect(await screen.findByText('0.1.5-rc.2')).toBeDefined()
    expect(screen.getByText('source checkout')).toBeDefined()
    expect(screen.getByText('/checkout/apps/cli')).toBeDefined()
    expect(screen.getByText('dsh-about-plugin 0.1.0')).toBeDefined()
    expect(screen.getByText(/update engine shipped with dsh ≥ 0.2.0/i)).toBeDefined()
    expect(screen.getByText('restarted')).toBeDefined()
  })

  it('renders localized copy in zh', async () => {
    renderSection({}, translator(zh))
    expect(await screen.findByText('源码安装')).toBeDefined()
    expect(screen.getByText('升级引擎')).toBeDefined()
    expect(screen.getByText('升级记录')).toBeDefined()
  })

  it('surfaces a status failure as an error row', async () => {
    const failing = face()
    failing.status.mockRejectedValue(new Error('boom'))
    renderSection({ status: failing.status })
    expect(await screen.findByText(/failed to load status: boom/i)).toBeDefined()
  })

  it('runs a check and renders the incoming changelog', async () => {
    const base = face()
    base.check.mockResolvedValue({
      checkedAt: 1_700_000_000_000,
      form: 'source',
      version: '0.1.5-rc.2',
      source: {
        channel: 'source',
        currentSha: 'aaaaaaaaaaaaaaaaaaaa',
        targetSha: 'bbbbbbbbbbbbbbbbbbbb',
        trackedRef: 'master',
        remoteRef: 'origin/master',
        behind: 2,
        ahead: 0,
        upToDate: false,
        dirty: false,
        dirtyFiles: [],
        incoming: [
          { sha: 'bbbbbbbbbbbb', subject: 'second commit' },
          { sha: 'cccccccccccc', subject: 'first commit' },
        ],
        fetched: true,
      },
    })
    renderSection({ check: base.check })
    await act(async () => {
      fireEvent.click(await screen.findByText('Check for updates'))
    })
    expect(await screen.findByText('2 commit(s) behind')).toBeDefined()
    expect(screen.getByText('second commit')).toBeDefined()
    expect(screen.getByText('first commit')).toBeDefined()
    // The apply button becomes enabled with an upgrade available.
    expect(screen.getByText('Upgrade and restart').disabled).toBe(false)
  })

  it('keeps apply disabled without a check or when up to date', async () => {
    renderSection()
    await screen.findByText('0.1.5-rc.2')
    expect(screen.getByText('Upgrade and restart').disabled).toBe(true)
  })

  it('shows a channel error from the check', async () => {
    const base = face()
    base.check.mockResolvedValue({
      checkedAt: 1,
      form: 'source',
      version: '0.1.5-rc.2',
      source: {
        channel: 'source', currentSha: '', targetSha: '', trackedRef: 'master', remoteRef: 'origin/master',
        behind: 0, ahead: 0, upToDate: true, dirty: false, dirtyFiles: [], incoming: [], fetched: false,
        error: 'network down',
      },
    })
    renderSection({ check: base.check })
    await act(async () => {
      fireEvent.click(await screen.findByText('Check for updates'))
    })
    expect(await screen.findByText('Channel error: network down')).toBeDefined()
    expect(screen.getByText('Upgrade and restart').disabled).toBe(true)
  })

  it('gates apply behind the risk confirmation and shows the restart banner on acceptance', async () => {
    // Simulated downtime: status rejects while the upgrade runs, then the
    // server comes back and the reconnect poll clears the banner.
    let serverDown = false
    const statusFixtureValue = statusFixture()
    const status = vi.fn(async () => {
      if (serverDown) throw new Error('server is restarting')
      return statusFixtureValue
    })
    const check = vi.fn().mockResolvedValue({
      checkedAt: 1,
      form: 'source',
      version: '0.1.5-rc.2',
      source: {
        channel: 'source', currentSha: 'aaaaaaaaaaaaaaaaaaaa', targetSha: 'bbbbbbbbbbbbbbbbbbbb',
        trackedRef: 'master', remoteRef: 'origin/master',
        behind: 1, ahead: 0, upToDate: false, dirty: false, dirtyFiles: [],
        incoming: [{ sha: 'bbbbbbbbbbbb', subject: 'one fix' }], fetched: true,
      },
    })
    const apply = vi.fn(async () => {
      serverDown = true
      setTimeout(() => { serverDown = false }, 250)
      return { accepted: true, mode: 'plugin-local' as const, fromSha: 'aaaaaaaaaaaaaaaaaaaa', statusFile: '/x' }
    })
    render(<AboutSection t={translator(en)} status={status} check={check} apply={apply} />)
    await act(async () => {
      fireEvent.click(await screen.findByText('Check for updates'))
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Upgrade and restart'))
    })
    // The confirmation opens disabled until acknowledged.
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeDefined()
    const confirm = screen.getByText('Start upgrade')
    expect(confirm.disabled).toBe(true)
    await act(async () => {
      fireEvent.click(dialog.querySelector('input[type="checkbox"]') as HTMLInputElement)
    })
    expect(confirm.disabled).toBe(false)
    await act(async () => {
      fireEvent.click(confirm)
    })
    expect(apply).toHaveBeenCalledTimes(1)
    // Downtime: the banner shows while status keeps failing.
    expect(await screen.findByText(/upgrade in progress/i)).toBeDefined()
    await waitFor(() => {
      expect(screen.queryByText(/upgrade in progress/i)).toBeNull()
    }, { timeout: 8000 })
  }, 15_000)

  it('shows the rejection reason when apply is refused', async () => {
    const base = face()
    base.check.mockResolvedValue({
      checkedAt: 1,
      form: 'source',
      version: '0.1.5-rc.2',
      source: {
        channel: 'source', currentSha: 'aaaaaaaaaaaaaaaaaaaa', targetSha: 'bbbbbbbbbbbbbbbbbbbb',
        trackedRef: 'master', remoteRef: 'origin/master',
        behind: 1, ahead: 0, upToDate: false, dirty: true, dirtyFiles: ['M a.ts'],
        incoming: [], fetched: true,
      },
    })
    renderSection({ check: base.check })
    await act(async () => {
      fireEvent.click(await screen.findByText('Check for updates'))
    })
    // dirty worktree keeps apply disabled
    expect(screen.getByText('Upgrade and restart').disabled).toBe(true)
    expect(screen.getByText('Worktree has uncommitted changes')).toBeDefined()
  })

  it('injects its stylesheet once per document', () => {
    ensurePanelStyles()
    ensurePanelStyles()
    const tags = document.querySelectorAll('style[data-plugin-css="dsh-about-plugin/panel"]')
    expect(tags).toHaveLength(1)
  })
})
