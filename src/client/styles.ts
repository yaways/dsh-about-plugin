/**
 * Panel styles, shipped as one injected stylesheet.
 *
 * A standalone browser bundle cannot lean on the repository's CSS-module
 * pipeline, so the panel owns a small prefixed stylesheet injected once at
 * factory execution (the same contract the pipeline's virtual loader gives
 * in-tree plugins: a tagged style at materialization). Token variables come
 * from the shell's design-token layer the settings dialog already renders
 * under, with safe fallbacks for standalone embedding.
 */

/** The stylesheet text; every class is namespaced under `dsh-about-`. */
export const PANEL_CSS = `
.dsh-about-root {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 720px;
}
.dsh-about-card {
  border: 1px solid var(--dsw-line, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-about-cardTitle {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.85;
  margin: 0;
}
.dsh-about-headline {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-about-version {
  font-size: 22px;
  font-weight: 650;
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.dsh-about-fact {
  display: flex;
  gap: 8px;
  font-size: 12.5px;
  opacity: 0.8;
  word-break: break-all;
}
.dsh-about-factLabel {
  flex: none;
  min-width: 88px;
  opacity: 0.7;
}
.dsh-about-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.dsh-about-note {
  margin: 0;
  font-size: 12.5px;
  opacity: 0.75;
}
.dsh-about-warn {
  border-color: var(--dsw-warning-line, rgba(191, 128, 0, 0.4));
}
.dsh-about-commits {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}
.dsh-about-commit {
  font-family: var(--dsw-font-mono, ui-monospace, monospace);
  font-size: 12px;
  display: flex;
  gap: 8px;
  align-items: baseline;
}
.dsh-about-commitSha {
  opacity: 0.55;
  flex: none;
}
.dsh-about-history {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow: auto;
}
.dsh-about-historyRow {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
  align-items: baseline;
}
.dsh-about-historyTime {
  opacity: 0.55;
  flex: none;
  font-variant-numeric: tabular-nums;
}
.dsh-about-historyEvent {
  flex: none;
  font-weight: 550;
}
.dsh-about-historyDetail {
  opacity: 0.75;
  word-break: break-all;
}
.dsh-about-error {
  color: var(--dsw-danger, #c0392b);
  font-size: 12.5px;
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}
.dsh-about-banner {
  border: 1px solid var(--dsw-line, rgba(0, 0, 0, 0.12));
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 13px;
  background: var(--dsw-surface-raised, rgba(127, 127, 127, 0.06));
}
.dsh-about-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
`

/** Tag attribute identifying the injected style element. */
export const STYLE_TAG_ID = 'dsh-about-plugin/panel'

/** Inject the stylesheet once per document. */
export function ensurePanelStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin-css="${STYLE_TAG_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-about-plugin'
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = PANEL_CSS
  document.head.appendChild(tag)
}
