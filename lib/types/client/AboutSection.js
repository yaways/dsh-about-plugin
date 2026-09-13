import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The About section: version facts, channel-aware update checks, the
 * supervised apply flow with restart confirmation and reconnection, and the
 * upgrade history from the status file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, RiskConfirmation, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import { ensurePanelStyles } from "./styles.js";
/** History-event to tag tone mapping. */
const EVENT_TONES = {
    started: 'outline',
    'step-ok': 'outline',
    'step-failed': 'danger',
    restarted: 'info',
    verified: 'success',
    failed: 'danger',
    'rolled-back': 'warning',
    orphaned: 'danger',
};
/** Localized history-event label key. */
function eventKey(event) {
    return `history.event.${event}`;
}
/** HH:MM:SS rendering for one wall-clock timestamp. */
function timeText(at) {
    return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
/** Version-fact tag tone per install form. */
function formTone(form) {
    return form === 'source' ? 'info' : form === 'npm' ? 'outline' : 'warning';
}
/** The About section content column. */
export function AboutSection({ t, status, check, apply }) {
    ensurePanelStyles();
    const [current, setCurrent] = useState(undefined);
    const [checkResult, setCheckResult] = useState(undefined);
    const [checking, setChecking] = useState(false);
    const [loadError, setLoadError] = useState(undefined);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [acknowledged, setAcknowledged] = useState(false);
    const [applyError, setApplyError] = useState(undefined);
    const [restarting, setRestarting] = useState(false);
    const pollRef = useRef(undefined);
    const refresh = useCallback(async () => {
        try {
            const next = await status();
            setCurrent(next);
            setLoadError(undefined);
            return next;
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
            return undefined;
        }
    }, [status]);
    useEffect(() => {
        void refresh();
    }, [refresh]);
    // After an accepted apply: poll until the server answers again, then show
    // the fresh status whose history carries the restarted/verified entries.
    useEffect(() => {
        if (!restarting)
            return;
        let cancelled = false;
        const poll = async () => {
            if (cancelled)
                return;
            const next = await refresh().catch(() => undefined);
            if (!cancelled && next !== undefined)
                setRestarting(false);
        };
        // One immediate probe (the restart may already be back), then the cadence.
        void poll();
        pollRef.current = setInterval(() => { void poll(); }, 3000);
        return () => {
            cancelled = true;
            if (pollRef.current !== undefined)
                clearInterval(pollRef.current);
            pollRef.current = undefined;
        };
    }, [restarting, refresh]);
    const runCheck = useCallback(async () => {
        setChecking(true);
        try {
            setCheckResult(await check());
        }
        catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
        finally {
            setChecking(false);
        }
    }, [check]);
    const runApply = useCallback(async () => {
        setConfirmOpen(false);
        setAcknowledged(false);
        setApplyError(undefined);
        try {
            const result = await apply();
            if (result.accepted) {
                setRestarting(true);
            }
            else {
                setApplyError(result.reason ?? t('apply.notAvailable'));
            }
        }
        catch (error) {
            setApplyError(error instanceof Error ? error.message : String(error));
        }
    }, [apply, t]);
    const source = checkResult?.source;
    const npm = checkResult?.npm;
    const canApply = useMemo(() => source !== undefined && source.error === undefined && source.behind > 0 && !source.dirty, [source]);
    return (_jsxs("div", { className: "dsh-about-root", children: [restarting
                ? _jsx("div", { className: "dsh-about-banner", role: "status", children: t('apply.restarting') })
                : null, loadError !== undefined
                ? _jsx("p", { className: "dsh-about-error", children: t('error.load', { message: loadError }) })
                : null, current !== undefined ? (_jsxs("section", { className: "dsh-about-card", "aria-label": t('version.title'), children: [_jsx("h3", { className: "dsh-about-cardTitle", children: t('version.title') }), _jsxs("div", { className: "dsh-about-headline", children: [_jsx("span", { className: "dsh-about-version", children: current.dsh.version }), _jsx(Tag, { tone: formTone(current.dsh.form), children: t(`version.form.${current.dsh.form}`) })] }), _jsxs("div", { className: "dsh-about-fact", children: [_jsx("span", { className: "dsh-about-factLabel", children: t('version.anchor') }), _jsx("span", { children: current.dsh.anchor })] }), _jsxs("div", { className: "dsh-about-fact", children: [_jsx("span", { className: "dsh-about-factLabel", children: t('version.plugin') }), _jsxs("span", { children: ["dsh-about-plugin ", current.pluginVersion] })] })] })) : null, _jsxs("section", { className: "dsh-about-card", "aria-label": t('channels.title'), children: [_jsx("h3", { className: "dsh-about-cardTitle", children: t('channels.title') }), current?.channels.map(channel => (_jsxs("p", { className: "dsh-about-note", children: [channel.channel === 'source' ? t('channels.source') : t('channels.npm', { package: current.dsh.form === 'npm' ? 'dsh' : '@deepseek-ai/dsh' }), channel.available ? '' : ` — ${t('channels.unavailable', { note: channel.note ?? '' })}`] }, channel.channel))), _jsxs("div", { className: "dsh-about-actions", children: [_jsx(Button, { variant: "outline", size: "sm", disabled: checking, onClick: () => { void runCheck(); }, children: checking ? t('check.running') : t('check') }), _jsx(Button, { variant: "primary", size: "sm", disabled: !canApply || restarting, onClick: () => { setConfirmOpen(true); }, children: t('apply') })] }), checkResult !== undefined ? (_jsxs("p", { className: "dsh-about-note", children: [t('check.at', { time: timeText(checkResult.checkedAt) }), source?.fetched === false ? ` ${t('check.notFetched')}` : ''] })) : null, source !== undefined && source.error === undefined ? (_jsxs("div", { children: [_jsxs("div", { className: "dsh-about-row", children: [_jsx(Tag, { tone: source.upToDate ? 'success' : 'info', children: source.upToDate ? t('check.upToDate') : t('check.behind', { count: String(source.behind) }) }), source.ahead > 0 ? _jsx(Tag, { tone: "outline", children: t('check.ahead', { count: String(source.ahead) }) }) : null, source.dirty ? _jsx(Tag, { tone: "warning", children: t('check.dirty') }) : null] }), _jsxs("p", { className: "dsh-about-note", children: [_jsx("span", { className: "dsh-about-commitSha", children: source.currentSha.slice(0, 12) }), ' → ', _jsx("span", { className: "dsh-about-commitSha", children: source.targetSha.slice(0, 12) }), ` (${source.remoteRef})`] }), source.incoming.length > 0 ? (_jsx("ul", { className: "dsh-about-commits", "aria-label": t('check.incoming'), children: source.incoming.map(commit => (_jsxs("li", { className: "dsh-about-commit", children: [_jsx("span", { className: "dsh-about-commitSha", children: commit.sha.slice(0, 8) }), _jsx("span", { children: commit.subject })] }, commit.sha))) })) : null] })) : null, source?.error !== undefined ? _jsx("p", { className: "dsh-about-error", children: t('check.error', { message: source.error }) }) : null, npm !== undefined && npm.error === undefined ? (_jsxs("div", { className: "dsh-about-row", children: [_jsxs(Tag, { tone: npm.upToDate ? 'success' : 'info', children: [npm.installed, npm.upToDate ? ` · ${t('check.upToDate')}` : ` → ${npm.latest}`] }), _jsx("span", { className: "dsh-about-note", children: t('check.npm.latest', { version: npm.latest }) })] })) : null, npm?.error !== undefined ? _jsx("p", { className: "dsh-about-error", children: t('check.error', { message: npm.error }) }) : null] }), applyError !== undefined ? _jsx("p", { className: "dsh-about-error", children: t('apply.rejected', { reason: applyError }) }) : null, _jsxs("section", { className: "dsh-about-card", "aria-label": t('history.title'), children: [_jsx("h3", { className: "dsh-about-cardTitle", children: t('history.title') }), current !== undefined && current.history.length > 0 ? (_jsx("ul", { className: "dsh-about-history", children: [...current.history].reverse().map((entry, index) => (_jsxs("li", { className: "dsh-about-historyRow", children: [_jsx("span", { className: "dsh-about-historyTime", children: timeText(entry.at) }), _jsx("span", { className: "dsh-about-historyEvent", children: _jsx(Tag, { tone: EVENT_TONES[entry.event] ?? 'outline', children: t(eventKey(entry.event)) }) }), entry.detail !== undefined ? _jsx("span", { className: "dsh-about-historyDetail", children: entry.detail }) : null] }, `${String(entry.at)}-${String(index)}`))) })) : (_jsx("p", { className: "dsh-about-note", children: t('history.empty') }))] }), _jsx(RiskConfirmation, { open: confirmOpen, title: t('apply.confirm.title'), description: t('apply.confirm.description'), acknowledgeLabel: t('apply.confirm.acknowledge'), cancelLabel: t('apply.confirm.cancel'), closeLabel: t('apply.confirm.close'), confirmLabel: t('apply.confirm.confirm'), acknowledged: acknowledged, disabled: !acknowledged, onAcknowledgedChange: setAcknowledged, onCancel: () => { setConfirmOpen(false); setAcknowledged(false); }, onConfirm: () => { void runApply(); } })] }));
}
//# sourceMappingURL=AboutSection.js.map