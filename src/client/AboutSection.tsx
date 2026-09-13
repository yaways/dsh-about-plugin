/**
 * The About section: version facts, channel-aware update checks, the
 * supervised apply flow with restart confirmation and reconnection, and the
 * upgrade history from the status file.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, RiskConfirmation, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ApplyResult, CheckResult, UpdateStatus } from '../schemas.ts'
import { ensurePanelStyles } from './styles.ts'
import type { AboutLocaleKey } from './locales.ts'

/** Registration-side Remote face the section consumes. */
export interface AboutSectionInjected {
  /** Read the at-rest status (version facts, engine, channels, history). */
  readonly status: () => Promise<UpdateStatus>
  /** Run a channel-aware update check. */
  readonly check: () => Promise<CheckResult>
  /** Start the supervised upgrade. */
  readonly apply: () => Promise<ApplyResult>
}

/** Full component props assembled by the Settings slot renderer. */
export type AboutSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.about'>
  & InjectFace<AboutSectionInjected>

type Translate = AboutSectionProps['t']

/** History-event to tag tone mapping. */
const EVENT_TONES: Record<string, TagTone> = {
  started: 'outline',
  'step-ok': 'outline',
  'step-failed': 'danger',
  restarted: 'info',
  verified: 'success',
  failed: 'danger',
  'rolled-back': 'warning',
  orphaned: 'danger',
}

/** Localized history-event label key. */
function eventKey(event: string): AboutLocaleKey {
  return `history.event.${event}` as AboutLocaleKey
}

/** HH:MM:SS rendering for one wall-clock timestamp. */
function timeText(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Version-fact tag tone per install form. */
function formTone(form: string): TagTone {
  return form === 'source' ? 'info' : form === 'npm' ? 'outline' : 'warning'
}

/** The About section content column. */
export function AboutSection({ t, status, check, apply }: AboutSectionProps) {
  ensurePanelStyles()
  const [current, setCurrent] = useState<UpdateStatus | undefined>(undefined)
  const [checkResult, setCheckResult] = useState<CheckResult | undefined>(undefined)
  const [checking, setChecking] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>(undefined)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const [applyError, setApplyError] = useState<string | undefined>(undefined)
  const [restarting, setRestarting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const next = await status()
      setCurrent(next)
      setLoadError(undefined)
      return next
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
      return undefined
    }
  }, [status])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // After an accepted apply: poll until the server answers again, then show
  // the fresh status whose history carries the restarted/verified entries.
  useEffect(() => {
    if (!restarting) return
    let cancelled = false
    const poll = async (): Promise<void> => {
      if (cancelled) return
      const next = await refresh().catch(() => undefined)
      if (!cancelled && next !== undefined) setRestarting(false)
    }
    // One immediate probe (the restart may already be back), then the cadence.
    void poll()
    pollRef.current = setInterval(() => { void poll() }, 3000)
    return () => {
      cancelled = true
      if (pollRef.current !== undefined) clearInterval(pollRef.current)
      pollRef.current = undefined
    }
  }, [restarting, refresh])

  const runCheck = useCallback(async () => {
    setChecking(true)
    try {
      setCheckResult(await check())
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setChecking(false)
    }
  }, [check])

  const runApply = useCallback(async () => {
    setConfirmOpen(false)
    setAcknowledged(false)
    setApplyError(undefined)
    try {
      const result = await apply()
      if (result.accepted) {
        setRestarting(true)
      } else {
        setApplyError(result.reason ?? t('apply.notAvailable'))
      }
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error))
    }
  }, [apply, t])

  const source = checkResult?.source
  const npm = checkResult?.npm
  const canApply = useMemo(
    () => source !== undefined && source.error === undefined && source.behind > 0 && !source.dirty,
    [source],
  )

  return (
    <div className="dsh-about-root">
      {restarting
        ? <div className="dsh-about-banner" role="status">{t('apply.restarting')}</div>
        : null}
      {loadError !== undefined
        ? <p className="dsh-about-error">{t('error.load', { message: loadError })}</p>
        : null}

      {current !== undefined ? (
        <section className="dsh-about-card" aria-label={t('version.title')}>
          <h3 className="dsh-about-cardTitle">{t('version.title')}</h3>
          <div className="dsh-about-headline">
            <span className="dsh-about-version">{current.dsh.version}</span>
            <Tag tone={formTone(current.dsh.form)}>{t(`version.form.${current.dsh.form}`)}</Tag>
          </div>
          <div className="dsh-about-fact">
            <span className="dsh-about-factLabel">{t('version.anchor')}</span>
            <span>{current.dsh.anchor}</span>
          </div>
          <div className="dsh-about-fact">
            <span className="dsh-about-factLabel">{t('version.plugin')}</span>
            <span>dsh-about-plugin {current.pluginVersion}</span>
          </div>
        </section>
      ) : null}

      {current !== undefined ? (
        <section className={`dsh-about-card${current.engine.available === false ? ' dsh-about-warn' : ''}`} aria-label={t('engine.title')}>
          <h3 className="dsh-about-cardTitle">{t('engine.title')}</h3>
          <p className="dsh-about-note">
            {current.engine.available === true
              ? t('engine.ok', { version: current.engine.requiredVersion })
              : t('engine.required', { version: current.engine.requiredVersion })}
          </p>
        </section>
      ) : null}

      <section className="dsh-about-card" aria-label={t('channels.title')}>
        <h3 className="dsh-about-cardTitle">{t('channels.title')}</h3>
        {current?.channels.map(channel => (
          <p className="dsh-about-note" key={channel.channel}>
            {channel.channel === 'source' ? t('channels.source') : t('channels.npm', { package: current.dsh.form === 'npm' ? 'dsh' : '@deepseek-ai/dsh' })}
            {channel.available ? '' : ` — ${t('channels.unavailable', { note: channel.note ?? '' })}`}
          </p>
        ))}
        <div className="dsh-about-actions">
          <Button variant="outline" size="sm" disabled={checking} onClick={() => { void runCheck() }}>
            {checking ? t('check.running') : t('check')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canApply || restarting}
            onClick={() => { setConfirmOpen(true) }}
          >
            {t('apply')}
          </Button>
        </div>

        {checkResult !== undefined ? (
          <p className="dsh-about-note">
            {t('check.at', { time: timeText(checkResult.checkedAt) })}
            {source?.fetched === false ? ` ${t('check.notFetched')}` : ''}
          </p>
        ) : null}

        {source !== undefined && source.error === undefined ? (
          <div>
            <div className="dsh-about-row">
              <Tag tone={source.upToDate ? 'success' : 'info'}>
                {source.upToDate ? t('check.upToDate') : t('check.behind', { count: String(source.behind) })}
              </Tag>
              {source.ahead > 0 ? <Tag tone="outline">{t('check.ahead', { count: String(source.ahead) })}</Tag> : null}
              {source.dirty ? <Tag tone="warning">{t('check.dirty')}</Tag> : null}
            </div>
            <p className="dsh-about-note">
              <span className="dsh-about-commitSha">{source.currentSha.slice(0, 12)}</span>
              {' → '}
              <span className="dsh-about-commitSha">{source.targetSha.slice(0, 12)}</span>
              {` (${source.remoteRef})`}
            </p>
            {source.incoming.length > 0 ? (
              <ul className="dsh-about-commits" aria-label={t('check.incoming')}>
                {source.incoming.map(commit => (
                  <li className="dsh-about-commit" key={commit.sha}>
                    <span className="dsh-about-commitSha">{commit.sha.slice(0, 8)}</span>
                    <span>{commit.subject}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {source?.error !== undefined ? <p className="dsh-about-error">{t('check.error', { message: source.error })}</p> : null}

        {npm !== undefined && npm.error === undefined ? (
          <div className="dsh-about-row">
            <Tag tone={npm.upToDate ? 'success' : 'info'}>
              {npm.installed}
              {npm.upToDate ? ` · ${t('check.upToDate')}` : ` → ${npm.latest}`}
            </Tag>
            <span className="dsh-about-note">{t('check.npm.latest', { version: npm.latest })}</span>
          </div>
        ) : null}
        {npm?.error !== undefined ? <p className="dsh-about-error">{t('check.error', { message: npm.error })}</p> : null}
      </section>

      {applyError !== undefined ? <p className="dsh-about-error">{t('apply.rejected', { reason: applyError })}</p> : null}

      <section className="dsh-about-card" aria-label={t('history.title')}>
        <h3 className="dsh-about-cardTitle">{t('history.title')}</h3>
        {current !== undefined && current.history.length > 0 ? (
          <ul className="dsh-about-history">
            {[...current.history].reverse().map((entry, index) => (
              <li className="dsh-about-historyRow" key={`${String(entry.at)}-${String(index)}`}>
                <span className="dsh-about-historyTime">{timeText(entry.at)}</span>
                <span className="dsh-about-historyEvent">
                  <Tag tone={EVENT_TONES[entry.event] ?? 'outline'}>{t(eventKey(entry.event))}</Tag>
                </span>
                {entry.detail !== undefined ? <span className="dsh-about-historyDetail">{entry.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="dsh-about-note">{t('history.empty')}</p>
        )}
      </section>

      <RiskConfirmation
        open={confirmOpen}
        title={t('apply.confirm.title')}
        description={t('apply.confirm.description')}
        acknowledgeLabel={t('apply.confirm.acknowledge')}
        cancelLabel={t('apply.confirm.cancel')}
        closeLabel={t('apply.confirm.close')}
        confirmLabel={t('apply.confirm.confirm')}
        acknowledged={acknowledged}
        disabled={!acknowledged}
        onAcknowledgedChange={setAcknowledged}
        onCancel={() => { setConfirmOpen(false); setAcknowledged(false) }}
        onConfirm={() => { void runApply() }}
      />
    </div>
  )
}
