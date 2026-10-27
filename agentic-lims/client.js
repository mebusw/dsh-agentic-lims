/* eslint-disable */
/**
 * Agentic LIMS — Client half.
 * Renders the workbench as a real tab in the DSH right sidebar. Data comes from
 * the authenticated `/api/lims/*` routes; chat tools write the same workspace
 * document this page polls, so a plan generated from chat appears here too.
 */
(function bootstrapAgenticLims() {
  if (typeof window === 'undefined' || !window.__ModuleLoader__) return;

  var CSS = `
.alims-root {
  --alims-brand: var(--dsw-alias-brand-primary);
  --alims-ok: var(--dsw-alias-state-success-primary);
  --alims-warn: var(--dsw-alias-state-warn-primary);
  --alims-err: var(--dsw-alias-state-error-primary);
  --alims-brand-bg: color-mix(in srgb, var(--alims-brand) 12%, transparent);
  --alims-brand-border: color-mix(in srgb, var(--alims-brand) 28%, transparent);
  --alims-ok-bg: color-mix(in srgb, var(--alims-ok) 13%, transparent);
  --alims-ok-border: color-mix(in srgb, var(--alims-ok) 30%, transparent);
  --alims-warn-bg: color-mix(in srgb, var(--alims-warn) 14%, transparent);
  --alims-warn-border: color-mix(in srgb, var(--alims-warn) 32%, transparent);
  --alims-err-bg: color-mix(in srgb, var(--alims-err) 12%, transparent);
  --alims-err-border: color-mix(in srgb, var(--alims-err) 30%, transparent);
  --alims-idle-bg: color-mix(in srgb, var(--dsw-alias-label-secondary) 9%, transparent);
  --alims-idle-border: color-mix(in srgb, var(--dsw-alias-label-secondary) 18%, transparent);
  --alims-track: color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent);
  --alims-action: #2563eb;
  --alims-action-hover: #1d4ed8;
  --alims-action-border: #1e40af;
  position: relative;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-size: 12.5px;
  line-height: 1.45;
  overflow: hidden;
  font-family: inherit;
}
.alims-root *, .alims-root *::before, .alims-root *::after { box-sizing: border-box; }
.alims-root button { font-family: inherit; }
.alims-top {
  flex: 0 0 auto;
  padding: 10px 12px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
}
.alims-brand { display: flex; align-items: center; gap: 8px; min-width: 0; }
.alims-logo {
  width: 26px; height: 26px; border-radius: 8px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--alims-brand), color-mix(in srgb, var(--alims-brand) 45%, var(--alims-ok)));
  box-shadow: 0 1px 2px color-mix(in srgb, var(--alims-brand) 30%, transparent);
}
.alims-brand-text { min-width: 0; }
.alims-title { font-size: 13.5px; font-weight: 650; letter-spacing: .1px; display: flex; align-items: baseline; gap: 6px; white-space: nowrap; }
.alims-title-en { font-size: 9.5px; font-weight: 600; color: var(--dsw-alias-label-secondary); letter-spacing: .4px; text-transform: uppercase; }
.alims-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-brand-spacer { flex: 1 1 auto; }
.alims-conn { display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.alims-conn-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--dsw-alias-state-warn-primary); }
.alims-conn.is-ok .alims-conn-dot { background: var(--alims-ok); }
.alims-menu { display: flex; gap: 2px; margin-top: 8px; overflow-x: auto; scrollbar-width: none; }
.alims-menu::-webkit-scrollbar { display: none; }
.alims-menu-item {
  display: inline-flex; align-items: center; gap: 4px;
  border: 0; background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 11.5px; padding: 6px 8px 7px; border-radius: 7px 7px 0 0;
  cursor: pointer; white-space: nowrap; position: relative;
}
.alims-menu-item:hover { color: var(--dsw-alias-label-primary); background: var(--alims-idle-bg); }
.alims-menu-item.is-active { color: var(--alims-brand); font-weight: 600; }
.alims-menu-item.is-active::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; border-radius: 2px; background: var(--alims-brand); }
.alims-menu-live { width: 5px; height: 5px; border-radius: 50%; background: var(--alims-ok); margin-left: 1px; }
.alims-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; scrollbar-width: thin; }
.alims-page { display: flex; flex-direction: column; gap: 10px; padding: 12px; }
.alims-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 11px; min-width: 0; }
.alims-muted-card { background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 72%, transparent); }
.alims-section-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 9px; }
.alims-section-heading { display: flex; align-items: baseline; gap: 6px; font-size: 12px; font-weight: 650; min-width: 0; }
.alims-section-meta { font-size: 10px; font-weight: 400; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-link { border: 1px solid var(--alims-action-border); background: var(--alims-action); color: #fff; font-size: 9.5px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 5px; white-space: nowrap; }
.alims-link:hover { background: var(--alims-action-hover); color: #fff; }
.alims-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  border-radius: 7px; border: 1px solid var(--alims-action-border);
  background: var(--alims-action); color: #fff;
  font-size: 11.5px; font-weight: 600; padding: 6px 10px; cursor: pointer;
}
.alims-btn:hover { background: var(--alims-action-hover); border-color: var(--alims-action-hover); color: #fff; }
.alims-btn:disabled { opacity: .45; cursor: not-allowed; }
.alims-btn-primary { background: var(--alims-action); border-color: var(--alims-action-border); color: #fff; }
.alims-btn-primary:hover { background: var(--alims-action-hover); }
.alims-btn-ghost { background: var(--alims-action); border-color: var(--alims-action-border); color: #fff; }
.alims-btn-ghost:hover { background: var(--alims-action-hover); }
.alims-icon-btn { width: 22px; height: 22px; border-radius: 5px; border: 1px solid var(--alims-action-border); background: var(--alims-action); color: #fff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.alims-icon-btn:hover { background: var(--alims-action-hover); }
.alims-pill { display: inline-flex; align-items: center; gap: 4px; border: 1px solid; border-radius: 999px; padding: 1px 6px; font-size: 9.5px; font-weight: 600; white-space: nowrap; line-height: 1.5; }
.alims-pill-dot { width: 4px; height: 4px; border-radius: 50%; }
.alims-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.alims-stat { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 9px 10px; min-width: 0; }
.alims-stat-top { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.alims-stat-label { font-size: 10.5px; color: var(--dsw-alias-label-secondary); }
.alims-stat-icon { display: inline-flex; }
.alims-stat-value { font-size: 22px; font-weight: 680; letter-spacing: -.4px; margin-top: 1px; }
.alims-stat-unit { font-size: 11px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 2px; }
.alims-stat-foot { font-size: 9.5px; color: var(--dsw-alias-label-secondary); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-agent-card { background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 62%); border-color: var(--alims-brand-border); }
.alims-agent-head { display: flex; align-items: center; gap: 8px; }
.alims-agent-icon { width: 26px; height: 26px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: var(--alims-brand); background: var(--alims-brand-bg); border: 1px solid var(--alims-brand-border); }
.alims-agent-title { font-size: 12px; font-weight: 650; }
.alims-agent-sub { font-size: 10px; color: var(--dsw-alias-label-secondary); }
.alims-agent-spacer { flex: 1 1 auto; }
.alims-prompt { margin-top: 9px; padding: 8px 10px; border-left: 2px solid var(--alims-brand); border-radius: 0 6px 6px 0; background: color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent); font-size: 11.5px; color: var(--dsw-alias-label-secondary); }
.alims-prompt-quote { font-style: italic; }
.alims-agent-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 9px; }
.alims-inline-note { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.alims-focus-list { display: flex; flex-direction: column; }
.alims-focus-row { display: flex; align-items: center; gap: 8px; padding: 7px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); cursor: pointer; }
.alims-focus-row:last-child { border-bottom: 0; }
.alims-focus-row:hover { background: var(--alims-idle-bg); border-radius: 6px; }
.alims-prio-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.alims-prio-dot.is-error { background: var(--alims-err); }
.alims-prio-dot.is-warn { background: var(--alims-warn); }
.alims-prio-dot.is-brand { background: var(--alims-brand); }
.alims-prio-dot.is-idle { background: var(--dsw-alias-state-idle-primary); }
.alims-focus-main { flex: 1 1 auto; min-width: 0; }
.alims-focus-name { font-size: 11.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-focus-meta { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-timeline { overflow-x: auto; }
.alims-tl-head, .alims-tl-row { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 6px; align-items: center; min-width: 420px; }
.alims-tl-head { margin-bottom: 3px; }
.alims-tl-label { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-tl-days { display: grid; grid-template-columns: repeat(16, minmax(0, 1fr)); gap: 1px; }
.alims-tl-day { text-align: center; font-size: 8px; color: var(--dsw-alias-label-secondary); line-height: 1.2; }
.alims-tl-day.is-today { color: var(--alims-brand); font-weight: 700; }
.alims-tl-dlabel { display: block; font-size: 8px; }
.alims-tl-wday { display: block; font-size: 7px; opacity: .7; }
.alims-tl-body { display: flex; flex-direction: column; gap: 3px; }
.alims-tl-row { cursor: pointer; }
.alims-tl-row:hover .alims-tl-track { background: var(--alims-idle-bg); }
.alims-tl-name { font-size: 9.5px; font-weight: 550; display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-tl-id { font-size: 8px; color: var(--dsw-alias-label-secondary); display: block; }
.alims-tl-track { position: relative; height: 15px; border-radius: 4px; background: color-mix(in srgb, var(--dsw-alias-label-secondary) 5%, transparent); min-width: 0; }
.alims-tl-bar { position: absolute; top: 2px; bottom: 2px; border: 1px solid; border-radius: 3px; display: flex; align-items: center; justify-content: center; overflow: hidden; min-width: 12px; }
.alims-tl-bar-label { font-size: 7.5px; font-weight: 700; line-height: 1; }
.alims-alert-list { display: flex; flex-direction: column; gap: 6px; }
.alims-alert { display: flex; gap: 7px; align-items: flex-start; padding: 7px 8px; border-radius: 7px; border: 1px solid var(--alims-warn-border); background: var(--alims-warn-bg); }
.alims-alert.is-error { border-color: var(--alims-err-border); background: var(--alims-err-bg); }
.alims-alert-icon { color: var(--alims-warn); margin-top: 1px; }
.alims-alert.is-error .alims-alert-icon { color: var(--alims-err); }
.alims-alert-body { flex: 1 1 auto; min-width: 0; }
.alims-alert-title { font-size: 10.5px; font-weight: 650; }
.alims-alert-detail { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.alims-load-list { display: flex; flex-direction: column; gap: 7px; }
.alims-load-row { display: grid; grid-template-columns: minmax(92px, 1.5fr) minmax(60px, 2fr) 34px 38px; gap: 6px; align-items: center; }
.alims-load-name { min-width: 0; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-load-name-btn { border: 0; background: transparent; color: inherit; text-align: left; padding: 0; cursor: pointer; display: block; width: 100%; font-family: inherit; }
.alims-load-name-btn:hover { color: var(--alims-action); }
.alims-load-name-btn:hover .alims-load-id { color: var(--alims-action); text-decoration: underline; }

.alims-load-id { display: block; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-load-value { font-size: 9.5px; font-weight: 650; text-align: right; }
.alims-load-hours { font-size: 9px; color: var(--dsw-alias-label-secondary); text-align: right; }
.alims-bar { width: 100%; border-radius: 99px; overflow: hidden; }
.alims-bar-fill { height: 100%; border-radius: 99px; transition: width .3s ease; }
.alims-audit-mini { display: flex; flex-direction: column; gap: 5px; }
.alims-audit-mini-row { display: flex; align-items: center; gap: 6px; font-size: 9.5px; }
.alims-audit-mini-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--alims-brand); flex: 0 0 auto; }
.alims-audit-mini-summary { flex: 1 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-audit-mini-time { color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.alims-filter-row { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 1px; }
.alims-filter { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); border-radius: 999px; padding: 4px 8px; font-size: 10.5px; cursor: pointer; white-space: nowrap; }
.alims-filter.is-active { color: #fff; border-color: var(--alims-action-border); background: var(--alims-action); font-weight: 600; }
.alims-filter-count { font-size: 8.5px; background: var(--alims-idle-bg); border-radius: 99px; padding: 0 4px; }
.alims-task-list { display: flex; flex-direction: column; gap: 7px; }
.alims-task-card { position: relative; display: flex; align-items: center; gap: 8px; text-align: left; width: 100%; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 9px 10px 9px 12px; cursor: pointer; color: inherit; overflow: hidden; }
.alims-task-card:hover { border-color: var(--dsw-alias-border-l2); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 80%, var(--alims-brand-bg)); }
.alims-task-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--dsw-alias-state-idle-primary); }
.alims-task-stripe.is-error { background: var(--alims-err); }
.alims-task-stripe.is-warn { background: var(--alims-warn); }
.alims-task-stripe.is-brand { background: var(--alims-brand); }
.alims-task-main { flex: 1 1 auto; min-width: 0; }
.alims-task-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.alims-task-name { font-size: 11.5px; font-weight: 650; }
.alims-task-meta { font-size: 9.5px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
.alims-task-tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; }
.alims-tag { display: inline-flex; align-items: center; gap: 3px; font-size: 8.5px; color: var(--dsw-alias-label-secondary); background: var(--alims-idle-bg); border-radius: 4px; padding: 1px 4px; }
.alims-tag.is-risk { color: var(--alims-err); background: var(--alims-err-bg); }
.alims-back { border: 1px solid var(--alims-action-border); background: var(--alims-action); color: #fff; font-size: 9.5px; font-weight: 600; cursor: pointer; padding: 3px 7px; border-radius: 5px; }
.alims-back:hover { background: var(--alims-action-hover); color: #fff; }
.alims-detail-head { display: flex; align-items: center; gap: 6px; }
.alims-detail-head-spacer { flex: 1 1 auto; }
.alims-detail-hero { background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 60%); }
.alims-detail-title { font-size: 16px; font-weight: 680; letter-spacing: -.2px; }
.alims-detail-sub { font-size: 9.5px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.alims-detail-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin-top: 10px; }
.alims-detail-metrics > div { display: flex; flex-direction: column; gap: 1px; }
.alims-detail-metrics span { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-detail-metrics strong { font-size: 11.5px; }
.alims-kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.alims-kv-grid > div { min-width: 0; }
.alims-kv-grid span { display: block; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-kv-grid strong { display: block; font-size: 10.5px; font-weight: 600; overflow-wrap: anywhere; }
.alims-candidate-list { display: flex; flex-direction: column; gap: 5px; }
.alims-candidate { display: flex; align-items: center; gap: 6px; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.alims-candidate:last-child { border-bottom: 0; }
.alims-candidate.is-blocked { opacity: .72; }
.alims-candidate-main { flex: 1 1 auto; min-width: 0; }
.alims-candidate-name { font-size: 10.5px; font-weight: 600; }
.alims-candidate-meta { font-size: 9px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.alims-chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.alims-mini-table { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; }
.alims-mini-row { display: grid; grid-template-columns: 70px 1fr 1.2fr 34px; gap: 4px; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-mini-value { text-align: right; color: var(--dsw-alias-label-primary); }
.alims-activity-list { display: flex; flex-direction: column; gap: 3px; margin-top: 5px; }
.alims-activity { display: flex; align-items: center; gap: 5px; font-size: 9px; }
.alims-activity-title { color: var(--dsw-alias-label-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.alims-plan-mini-list { display: flex; flex-direction: column; gap: 4px; }
.alims-plan-mini { display: flex; align-items: center; gap: 6px; width: 100%; text-align: left; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); border-radius: 6px; padding: 5px 7px; font-size: 9.5px; cursor: pointer; color: inherit; }
.alims-plan-mini:hover { border-color: var(--alims-brand-border); }
.alims-plan-mini-id { font-family: ui-monospace, monospace; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-plan-mini-strategy { flex: 1 1 auto; }
.alims-plan-mini-score { color: var(--alims-brand); font-weight: 650; }
.alims-schedule-toolbar { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
.alims-schedule-task { flex: 1 1 180px; min-width: 0; }
.alims-field-label { display: block; font-size: 9px; color: var(--dsw-alias-label-secondary); margin-bottom: 3px; }
.alims-select { width: 100%; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 5px 7px; font-size: 10.5px; font-family: inherit; }
.alims-select-sm { width: auto; }
.alims-schedule-actions { display: flex; gap: 5px; }
.alims-callout { display: flex; align-items: flex-start; gap: 6px; border: 1px solid var(--alims-warn-border); background: var(--alims-warn-bg); color: var(--alims-warn); border-radius: 8px; padding: 7px 9px; font-size: 9.5px; }
.alims-callout strong { margin-right: 2px; }
.alims-plan-strip { display: flex; gap: 7px; overflow-x: auto; padding-bottom: 2px; scroll-snap-type: x mandatory; }
.alims-plan-card { flex: 1 0 200px; max-width: 260px; scroll-snap-align: start; text-align: left; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 9px; padding: 9px; cursor: pointer; color: inherit; display: flex; flex-direction: column; gap: 4px; }
.alims-plan-card:hover { border-color: var(--dsw-alias-border-l2); }
.alims-plan-card.is-selected { border-color: var(--alims-brand); box-shadow: 0 0 0 1px var(--alims-brand-border) inset; background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 70%); }
.alims-plan-card-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.alims-plan-option { display: inline-flex; width: 16px; height: 16px; align-items: center; justify-content: center; border-radius: 4px; background: var(--alims-brand); color: #fff; font-size: 9px; font-weight: 700; margin-right: 4px; }
.alims-plan-strategy { font-size: 10px; font-weight: 650; }
.alims-plan-score { font-size: 22px; font-weight: 700; letter-spacing: -.5px; line-height: 1.1; }
.alims-plan-score span { font-size: 9px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 2px; }
.alims-plan-card-time { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-plan-card-meta { display: flex; flex-direction: column; gap: 1px; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-plan-card-foot { display: flex; align-items: center; justify-content: space-between; font-size: 8.5px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 4px; margin-top: 1px; }
.is-late { color: var(--alims-err); font-weight: 650; }
.is-ok { color: var(--alims-ok); font-weight: 650; }
.alims-plan-detail { display: flex; flex-direction: column; gap: 10px; }
.alims-plan-summary-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-plan-summary-title { font-size: 11px; font-weight: 650; font-family: ui-monospace, monospace; }
.alims-plan-summary-sub { font-size: 9.5px; color: var(--dsw-alias-label-secondary); }
.alims-plan-kpis { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; margin: 9px 0; }
.alims-plan-kpis > div { display: flex; flex-direction: column; gap: 1px; }
.alims-plan-kpis span { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-plan-kpis strong { font-size: 11px; }
.alims-score-bars { display: flex; flex-direction: column; gap: 3px; padding: 7px 0; border-top: 1px solid var(--dsw-alias-border-l1); border-bottom: 1px solid var(--dsw-alias-border-l1); }
.alims-score-row { display: grid; grid-template-columns: 62px 1fr 34px; gap: 6px; align-items: center; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-score-bar { min-width: 0; }
.alims-score-value { text-align: right; }
.alims-plan-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 9px; }
.alims-gantt-pager { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px; }
.alims-gantt-range { font-size: 9px; font-weight: 600; color: var(--dsw-alias-label-secondary); }
.alims-gantt-pager-actions { display: flex; align-items: center; gap: 4px; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-gantt-pager-actions .alims-icon-btn { width: 18px; height: 18px; }
.alims-gantt-weeklabel { font-size: 8px; color: var(--dsw-alias-label-secondary); font-style: italic; }
.alims-gantt { overflow-x: auto; padding-bottom: 2px; }
.alims-gantt-grid { display: grid; gap: 1px; min-width: 360px; background: var(--dsw-alias-border-l1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; }
.alims-gantt-corner, .alims-gantt-day, .alims-gantt-label, .alims-gantt-cell { background: var(--dsw-alias-bg-layer-1); padding: 3px 4px; min-height: 34px; }
.alims-gantt-corner { display: flex; align-items: center; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-gantt-day { text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0; }
.alims-gantt-day span { font-size: 8.5px; font-weight: 600; }
.alims-gantt-day small { font-size: 7.5px; color: var(--dsw-alias-label-secondary); }
.alims-gantt-label { display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.alims-gantt-label span { font-size: 8.5px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-gantt-label small { font-size: 7px; color: var(--dsw-alias-label-secondary); }
.alims-gantt-dot { width: 5px; height: 5px; border-radius: 50%; display: inline-block; margin-right: 3px; }
.alims-gantt-cell { padding: 2px; display: flex; align-items: center; min-height: 38px; }
.alims-gantt-bar { width: 100%; min-height: 32px; border-radius: 4px; border: 1px solid; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.05; gap: 1px; overflow: hidden; padding: 1px 0; }
.alims-gantt-bar span { font-size: 6.5px; font-weight: 650; white-space: nowrap; }
.alims-gantt-bar-time { letter-spacing: -.2px; }
.alims-gantt-bar small { font-size: 7px; opacity: .9; }
.alims-gantt-legend { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 5px; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-gantt-legend span { display: inline-flex; align-items: center; gap: 3px; }
.alims-gantt-legend i { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.alims-gantt-assumption { margin-left: auto; font-style: italic; }
.alims-segment-list { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.alims-segment { display: grid; grid-template-columns: 64px 66px 26px 1fr; gap: 5px; font-size: 8.5px; align-items: center; }
.alims-segment-date { color: var(--dsw-alias-label-secondary); }
.alims-segment-time { font-family: ui-monospace, monospace; }
.alims-segment-hours { color: var(--alims-brand); font-weight: 650; }
.alims-segment-res { color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-constraints { display: flex; flex-direction: column; gap: 4px; }
.alims-constraint { display: flex; align-items: flex-start; gap: 6px; padding: 5px 6px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l1); }
.alims-constraint.is-fail { border-color: var(--alims-err-border); background: var(--alims-err-bg); }
.alims-constraint.is-warn { border-color: var(--alims-warn-border); background: var(--alims-warn-bg); }
.alims-constraint-icon { margin-top: 1px; color: var(--alims-ok); }
.alims-constraint.is-fail .alims-constraint-icon { color: var(--alims-err); }
.alims-constraint.is-warn .alims-constraint-icon { color: var(--alims-warn); }
.alims-constraint-body { flex: 1 1 auto; min-width: 0; }
.alims-constraint-name { font-size: 9.5px; font-weight: 600; }
.alims-constraint-code { font-family: ui-monospace, monospace; font-size: 7.5px; color: var(--dsw-alias-label-secondary); margin-left: 4px; font-weight: 400; }
.alims-constraint-text { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-risk-list { display: flex; flex-direction: column; gap: 4px; }
.alims-risk { display: flex; align-items: center; gap: 5px; font-size: 9.5px; }
.alims-risk.is-high { color: var(--alims-err); }
.alims-risk.is-medium { color: var(--alims-warn); }
.alims-assumptions { margin: 6px 0 0; padding-left: 16px; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-assumptions li { margin-bottom: 2px; }
.alims-resource-list, .alims-person-list, .alims-space-list { display: flex; flex-direction: column; gap: 6px; }
.alims-resource { display: flex; align-items: center; gap: 7px; padding: 6px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.alims-resource:last-child { border-bottom: 0; }
.alims-status-dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; background: var(--dsw-alias-state-idle-primary); }
.alims-status-dot.is-ok { background: var(--alims-ok); }
.alims-status-dot.is-warn { background: var(--alims-warn); }
.alims-resource-main { flex: 1 1 auto; min-width: 0; }
.alims-resource-head { display: flex; align-items: center; gap: 5px; font-size: 10.5px; flex-wrap: wrap; }
.alims-resource-meta { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-resource-load { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
.alims-resource-load > span { font-size: 8px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.alims-resource-load .alims-bar { flex: 0 1 90px; }
.alims-person { border-bottom: 1px solid var(--dsw-alias-border-l1); padding: 6px 0; }
.alims-person:last-child { border-bottom: 0; }
.alims-person-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; font-size: 10.5px; }
.alims-person-id { font-size: 8px; color: var(--dsw-alias-label-secondary); margin-left: 4px; }
.alims-person-meta { font-size: 8.5px; color: var(--dsw-alias-label-secondary); margin: 1px 0 3px; }
.alims-person-bar { margin-top: 4px; }
.alims-space { display: grid; grid-template-columns: minmax(110px, 1.3fr) minmax(50px, 1fr) 28px auto; gap: 6px; align-items: center; padding: 5px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); font-size: 10px; }
.alims-space:last-child { border-bottom: 0; }
.alims-space-pct { font-size: 9px; text-align: right; }
.alims-explain-card { border-color: var(--alims-brand-border); background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 70%); }
.alims-explain-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; margin-bottom: 7px; }
.alims-explain-title { font-size: 12px; font-weight: 650; }
.alims-explain-sub { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-explain-body { display: flex; flex-direction: column; gap: 3px; }
.alims-explain-row { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 9.5px; }
.alims-explain-row > span { color: var(--dsw-alias-label-secondary); }
.alims-explain-reasons { display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.alims-explain-reason { display: flex; align-items: flex-start; gap: 4px; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-explain-alts { margin-top: 5px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-explain-alt { display: flex; flex-direction: column; gap: 1px; padding: 3px 0; font-size: 9px; }
.alims-explain-alt span { color: var(--dsw-alias-label-secondary); }
.alims-bottleneck { display: flex; align-items: center; gap: 8px; border-color: var(--alims-warn-border); background: linear-gradient(135deg, var(--alims-warn-bg), var(--dsw-alias-bg-layer-1) 70%); }
.alims-bottleneck-icon { width: 28px; height: 28px; border-radius: 8px; background: var(--alims-warn-bg); color: var(--alims-warn); display: flex; align-items: center; justify-content: center; }
.alims-bottleneck-body { flex: 1 1 auto; min-width: 0; }
.alims-bottleneck-title { font-size: 10px; font-weight: 650; color: var(--alims-warn); }
.alims-bottleneck-text { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-bottleneck-value { font-size: 24px; font-weight: 700; letter-spacing: -.5px; }
.alims-bottleneck-value span { font-size: 10px; font-weight: 500; margin-left: 1px; }
.alims-bucket-list { display: flex; flex-direction: column; gap: 5px; }
.alims-bucket { display: grid; grid-template-columns: 58px minmax(40px, 1fr) 18px; gap: 5px; align-items: center; font-size: 9px; }
.alims-bucket-label { color: var(--dsw-alias-label-secondary); }
.alims-bucket-bar { height: 7px; border-radius: 99px; background: var(--alims-track); overflow: hidden; }
.alims-bucket-fill { height: 100%; border-radius: 99px; background: var(--alims-brand); }
.alims-bucket-count { text-align: right; font-weight: 650; }
.alims-bucket-detail { grid-column: 2 / 4; font-size: 7.5px; color: var(--dsw-alias-label-secondary); margin-top: -3px; }
.alims-risk-table { display: flex; flex-direction: column; gap: 4px; }
.alims-risk-table-row { display: flex; align-items: center; gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.alims-risk-table-row:last-child { border-bottom: 0; }
.alims-risk-table-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.alims-risk-table-main strong { font-size: 9.5px; }
.alims-risk-table-main span { font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-risk-table-reason { font-size: 8px; color: var(--dsw-alias-label-secondary); max-width: 42%; text-align: right; }
.alims-simulate { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; }
.alims-simulate .alims-select { flex: 1 1 120px; }
.alims-simulate-result { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin-top: 8px; padding-top: 7px; border-top: 1px solid var(--dsw-alias-border-l1); }
.alims-simulate-result > div { display: flex; flex-direction: column; gap: 1px; }
.alims-simulate-result span { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-simulate-result strong { font-size: 11px; }
.alims-simulate-result p { grid-column: 1 / -1; margin: 2px 0 0; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-audit { display: flex; flex-direction: column; gap: 5px; }
.alims-audit-row { display: flex; gap: 7px; align-items: flex-start; padding: 5px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.alims-audit-row:last-child { border-bottom: 0; }
.alims-audit-dot { width: 5px; height: 5px; border-radius: 50%; margin-top: 5px; flex: 0 0 auto; background: var(--alims-brand); }
.alims-audit-dot.is-plan_confirmed { background: var(--alims-ok); }
.alims-audit-dot.is-plans_blocked { background: var(--alims-err); }
.alims-audit-main { flex: 1 1 auto; min-width: 0; }
.alims-audit-summary { font-size: 9.5px; font-weight: 600; }
.alims-audit-detail { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-audit-meta { font-size: 7.5px; color: var(--dsw-alias-label-secondary); }
.alims-disclaimer { font-size: 8px; color: var(--dsw-alias-label-secondary); line-height: 1.5; padding: 0 2px; }
.alims-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px; padding: 26px 12px; text-align: center; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 9px; background: var(--dsw-alias-bg-layer-1); }
.alims-empty-icon { width: 32px; height: 32px; border-radius: 10px; background: var(--alims-brand-bg); color: var(--alims-brand); display: flex; align-items: center; justify-content: center; }
.alims-empty-title { font-size: 11px; font-weight: 650; }
.alims-empty-detail { font-size: 9px; color: var(--dsw-alias-label-secondary); max-width: 280px; }
.alims-loading { display: flex; align-items: center; gap: 7px; padding: 22px 10px; justify-content: center; color: var(--dsw-alias-label-secondary); font-size: 10px; }
.alims-spinner { width: 12px; height: 12px; border: 2px solid var(--alims-track); border-top-color: var(--alims-brand); border-radius: 50%; animation: alims-spin .8s linear infinite; }
.alims-error { display: flex; align-items: center; gap: 7px; border: 1px solid var(--alims-err-border); background: var(--alims-err-bg); color: var(--alims-err); border-radius: 8px; padding: 8px 9px; }
.alims-error-body { flex: 1 1 auto; min-width: 0; }
.alims-error-title { font-size: 10px; font-weight: 650; }
.alims-error-detail { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-toast { position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 20; display: flex; align-items: flex-start; gap: 7px; padding: 8px 9px; border-radius: 8px; background: var(--dsw-alias-bg-overlay); border: 1px solid var(--dsw-alias-border-l2); box-shadow: 0 6px 22px rgba(0,0,0,.18); animation: alims-in .18s ease; }
.alims-toast.is-ok { border-color: var(--alims-ok-border); }
.alims-toast.is-error { border-color: var(--alims-err-border); }
.alims-toast-icon { color: var(--alims-brand); margin-top: 1px; }
.alims-toast.is-ok .alims-toast-icon { color: var(--alims-ok); }
.alims-toast.is-error .alims-toast-icon { color: var(--alims-err); }
.alims-toast-body { flex: 1 1 auto; min-width: 0; }
.alims-toast-title { font-size: 10px; font-weight: 650; }
.alims-toast-detail { font-size: 8.5px; color: var(--dsw-alias-label-secondary); white-space: pre-line; max-height: 62px; overflow: auto; }
.alims-toast-close { border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.alims-muted { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-impact-form { border-color: var(--alims-warn-border); background: linear-gradient(135deg, var(--alims-warn-bg), var(--dsw-alias-bg-layer-1) 65%); }
.alims-impact-form-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; margin-bottom: 8px; }
.alims-impact-form-title { font-size: 12px; font-weight: 680; }
.alims-impact-form-sub { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-impact-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.alims-impact-field { min-width: 0; }
.alims-impact-field:first-child { grid-column: 1 / -1; }
.alims-impact-field .alims-select { width: 100%; }
.alims-impact-hero { border-color: var(--alims-warn-border); }
.alims-impact-hero-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-impact-hero-title { font-size: 13px; font-weight: 680; }
.alims-impact-hero-sub { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-impact-hero-meta { margin-top: 4px; font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-impact-list { display: flex; flex-direction: column; gap: 8px; }
.alims-impact-task { display: flex; flex-direction: column; gap: 6px; }
.alims-impact-task-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-impact-task-title { font-size: 11.5px; font-weight: 650; }
.alims-impact-task-meta { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-compare { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-compare-row { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 5px; align-items: flex-start; }
.alims-compare-label { font-size: 8.5px; color: var(--dsw-alias-label-secondary); padding-top: 1px; }
.alims-compare-row.is-after .alims-compare-label { color: var(--alims-brand); font-weight: 650; }
.alims-compare-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.alims-compare-main strong { font-size: 9.5px; }
.alims-compare-main span { font-size: 8px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.alims-compare-row.is-after .alims-compare-main strong { color: var(--alims-brand); }
.alims-compare-blocked { font-size: 8.5px; color: var(--alims-err); }
.alims-impact-actions { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; font-size: 9px; }
.alims-impact-risks { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 4px; }
.alims-impact-risks .alims-risk { font-size: 8.5px; }
.alims-revise-card { border-color: var(--alims-brand-border); background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 70%); }
.alims-revise-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; align-items: end; }
.alims-revise-check { display: inline-flex; align-items: center; gap: 5px; font-size: 9.5px; color: var(--dsw-alias-label-primary); padding-bottom: 5px; grid-column: 1 / -1; }
.alims-revise-check input { accent-color: var(--alims-brand); }
.alims-revise-field { min-width: 0; }
.alims-revise-field .alims-select { width: 100%; }
.alims-compare-card { border-color: var(--alims-brand-border); background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 62%); }
.alims-compare-grid { display: grid; grid-template-columns: minmax(0, 1fr) 18px minmax(0, 1fr); gap: 4px; align-items: stretch; }
.alims-compare-side { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 6px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent); }
.alims-compare-side.is-after { border-color: var(--alims-brand-border); background: var(--alims-brand-bg); }
.alims-compare-side-label { font-size: 8px; color: var(--dsw-alias-label-secondary); text-transform: uppercase; letter-spacing: .3px; }
.alims-compare-side strong { font-size: 9.5px; }
.alims-compare-side span { font-size: 8px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.alims-compare-arrow { display: flex; align-items: center; justify-content: center; color: var(--alims-brand); }
.alims-compare-deltas { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.alims-compare-changes { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-compare-change { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 5px; font-size: 8.5px; align-items: start; }
.alims-compare-change span { color: var(--dsw-alias-label-secondary); }
.alims-compare-change strong { font-weight: 550; overflow-wrap: anywhere; }
.alims-compare-change.is-warn strong { color: var(--alims-warn); }
.alims-role { display: inline-flex; align-items: center; gap: 3px; color: var(--dsw-alias-label-secondary); }
.alims-role-select { background: transparent; color: var(--dsw-alias-label-primary); border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; font-size: 9.5px; padding: 2px 4px; font-family: inherit; max-width: 88px; }
.alims-personal-view { border-color: var(--alims-brand-border); background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 70%); }
.alims-personal-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-personal-title { font-size: 12px; font-weight: 680; }
.alims-personal-sub { font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-personal-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; margin: 8px 0; }
.alims-personal-stats > div { display: flex; flex-direction: column; gap: 1px; }
.alims-personal-stats span { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-personal-stats strong { font-size: 13px; }
.alims-personal-days { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 6px; }
.alims-personal-day { display: grid; grid-template-columns: 34px minmax(40px, 1fr) 30px; gap: 5px; align-items: center; font-size: 8.5px; }
.alims-personal-day-label { color: var(--dsw-alias-label-secondary); }
.alims-personal-day-value { text-align: right; }
.alims-personal-activities { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-personal-tasks { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-personal-task { display: flex; align-items: center; gap: 5px; width: 100%; text-align: left; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); border-radius: 5px; padding: 4px 6px; font-size: 9px; cursor: pointer; color: inherit; }
.alims-personal-task:hover { border-color: var(--alims-brand-border); }
.alims-personal-task span { flex: 0 0 auto; font-weight: 600; }
.alims-personal-task small { flex: 1 1 auto; color: var(--dsw-alias-label-secondary); font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-ops-focus { border-color: var(--alims-warn-border); background: linear-gradient(135deg, var(--alims-warn-bg), var(--dsw-alias-bg-layer-1) 70%); }
.alims-ops-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-ops-bottleneck { display: flex; align-items: flex-start; gap: 5px; margin-top: 7px; font-size: 9px; color: var(--dsw-alias-label-secondary); }
.alims-ops-bottleneck svg { color: var(--alims-warn); margin-top: 1px; }
.alims-ops-risks { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-ops-risk { display: flex; align-items: flex-start; gap: 5px; }
.alims-ops-risk > div { display: flex; flex-direction: column; min-width: 0; }
.alims-ops-risk strong { font-size: 9px; }
.alims-ops-risk span { font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-project-list { display: flex; flex-direction: column; gap: 8px; }
.alims-project-card { text-align: left; width: 100%; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; padding: 10px; cursor: pointer; color: inherit; display: flex; flex-direction: column; gap: 4px; }
.alims-project-card:hover { border-color: var(--alims-action); background: color-mix(in srgb, var(--dsw-alias-bg-layer-1) 82%, var(--alims-brand-bg)); }
.alims-project-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-project-title { font-size: 12px; font-weight: 680; line-height: 1.35; }
.alims-project-code { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-project-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
.alims-project-templates { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 2px; }
.alims-project-foot { display: flex; align-items: center; justify-content: space-between; font-size: 8.5px; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 4px; margin-top: 2px; }
.alims-project-hero { background: linear-gradient(135deg, var(--alims-brand-bg), var(--dsw-alias-bg-layer-1) 70%); border-color: var(--alims-brand-border); }
.alims-project-groups { display: flex; flex-direction: column; gap: 8px; }
.alims-project-group { display: flex; flex-direction: column; gap: 6px; }
.alims-project-group-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-project-group-title { font-size: 11.5px; font-weight: 650; }
.alims-project-group-sub { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-project-task-list { display: flex; flex-direction: column; gap: 3px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-project-task { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto auto; gap: 5px; align-items: center; width: 100%; text-align: left; border: 0; background: transparent; color: inherit; padding: 3px 0; cursor: pointer; font-size: 9px; }
.alims-project-task:hover { background: var(--alims-idle-bg); border-radius: 4px; }
.alims-project-task-name { font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-project-task-meta { color: var(--dsw-alias-label-secondary); font-size: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-project-testplans { display: flex; flex-direction: column; gap: 8px; }
.alims-testplan-card { display: flex; flex-direction: column; gap: 6px; }
.alims-testplan-card.is-selected { border-color: var(--alims-brand); }
.alims-testplan-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 6px; }
.alims-testplan-title { font-size: 11.5px; font-weight: 650; }
.alims-testplan-sub { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-testplan-timeline { overflow-x: auto; padding-bottom: 2px; }
.alims-testplan-grid { display: grid; gap: 1px; min-width: 340px; background: var(--dsw-alias-border-l1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; }
.alims-testplan-corner, .alims-testplan-day, .alims-testplan-label, .alims-testplan-cell { background: var(--dsw-alias-bg-layer-1); padding: 3px 4px; min-height: 30px; }
.alims-testplan-corner { display: flex; align-items: center; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-testplan-day { display: flex; flex-direction: column; align-items: center; justify-content: center; }
.alims-testplan-day span { font-size: 8px; font-weight: 600; }
.alims-testplan-day small { font-size: 7px; color: var(--dsw-alias-label-secondary); }
.alims-testplan-label { display: flex; flex-direction: column; justify-content: center; gap: 1px; }
.alims-testplan-label span { font-size: 8px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-testplan-label small { font-size: 7px; color: var(--dsw-alias-label-secondary); }
.alims-testplan-cell { padding: 2px; display: flex; align-items: center; min-height: 38px; }
.alims-testplan-bar { width: 100%; min-height: 32px; border-radius: 4px; border: 1px solid; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.05; gap: 1px; overflow: hidden; padding: 1px 0; }
.alims-testplan-bar span { font-size: 6.5px; font-weight: 650; white-space: nowrap; }
.alims-testplan-bar small { font-size: 7px; opacity: .9; }
.alims-testplan-actions { display: flex; align-items: center; justify-content: space-between; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
.alims-tool-card {
  --alims-brand: var(--dsw-alias-brand-primary);
  --alims-ok: var(--dsw-alias-state-success-primary);
  --alims-warn: var(--dsw-alias-state-warn-primary);
  --alims-err: var(--dsw-alias-state-error-primary);
  --alims-brand-bg: color-mix(in srgb, var(--alims-brand) 12%, transparent);
  --alims-ok-bg: color-mix(in srgb, var(--alims-ok) 13%, transparent);
  --alims-warn-bg: color-mix(in srgb, var(--alims-warn) 14%, transparent);
  --alims-err-bg: color-mix(in srgb, var(--alims-err) 12%, transparent);
  --alims-track: color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent);
  --alims-action: #2563eb;
  --alims-action-hover: #1d4ed8;
  --alims-action-border: #1e40af;
}
.alims-tool-card { width: 100%; max-width: 760px; background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; padding: 11px 12px; display: flex; flex-direction: column; gap: 8px; color: var(--dsw-alias-label-primary); font-size: 12px; }
.alims-tool-card.is-pending { border-style: dashed; }
.alims-tool-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.alims-tool-icon { width: 24px; height: 24px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; color: var(--alims-action); background: color-mix(in srgb, var(--alims-action) 12%, transparent); }
.alims-tool-icon.is-ok { color: var(--alims-ok); background: var(--alims-ok-bg); }
.alims-tool-icon.is-warn { color: var(--alims-warn); background: var(--alims-warn-bg); }
.alims-tool-icon.is-error { color: var(--alims-err); background: var(--alims-err-bg); }
.alims-tool-head-text { flex: 1 1 auto; min-width: 0; }
.alims-tool-title { font-size: 12px; font-weight: 680; }
.alims-tool-sub { font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-tool-badge { font-size: 8px; font-weight: 700; letter-spacing: .5px; color: var(--alims-action); border: 1px solid color-mix(in srgb, var(--alims-action) 30%, transparent); background: color-mix(in srgb, var(--alims-action) 8%, transparent); border-radius: 4px; padding: 1px 4px; flex: 0 0 auto; }
.alims-tool-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 6px; }
.alims-tool-kpi { display: flex; flex-direction: column; gap: 1px; padding: 6px 7px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 45%, transparent); min-width: 0; }
.alims-tool-kpi span { font-size: 9px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-tool-kpi strong { font-size: 17px; font-weight: 700; letter-spacing: -.3px; }
.alims-tool-kpi small { font-size: 9px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 1px; }
.alims-tool-progress { height: 5px; border-radius: 99px; background: var(--alims-track); overflow: hidden; }
.alims-tool-progress-fill { height: 100%; border-radius: 99px; background: var(--alims-action); }
.alims-tool-list { display: flex; flex-direction: column; gap: 3px; }
.alims-tool-row { display: flex; align-items: center; gap: 7px; padding: 4px 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); min-width: 0; }
.alims-tool-row:last-child { border-bottom: 0; }
.alims-tool-row.is-block { align-items: flex-start; }
.alims-tool-row > div { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.alims-tool-row strong { font-size: 10.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-tool-row span { font-size: 9px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.alims-tool-row-value { flex: 0 0 auto !important; font-size: 10px; font-weight: 650; color: var(--alims-action) !important; }
.alims-tool-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--alims-action); flex: 0 0 auto; }
.alims-tool-dot.is-warn { background: var(--alims-warn); }
.alims-tool-plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; }
.alims-tool-plan { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; padding: 7px; display: flex; flex-direction: column; gap: 2px; background: color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent); }
.alims-tool-plan-head { display: flex; align-items: center; justify-content: space-between; gap: 4px; }
.alims-tool-plan-head strong { font-size: 10px; }
.alims-tool-plan-score { font-size: 18px; font-weight: 700; color: var(--alims-action); line-height: 1.1; }
.alims-tool-plan-score small { font-size: 8px; font-weight: 500; color: var(--dsw-alias-label-secondary); margin-left: 1px; }
.alims-tool-plan-meta { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-tool-compare { display: grid; grid-template-columns: 1fr 16px 1fr; gap: 4px; align-items: stretch; }
.alims-tool-compare-side { border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; padding: 6px 7px; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.alims-tool-compare-side.is-after { border-color: color-mix(in srgb, var(--alims-action) 35%, transparent); background: color-mix(in srgb, var(--alims-action) 7%, transparent); }
.alims-tool-compare-side span { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-tool-compare-side strong { font-size: 10.5px; }
.alims-tool-compare-side small { font-size: 8.5px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
.alims-tool-compare-arrow { display: flex; align-items: center; justify-content: center; color: var(--alims-action); }
.alims-tool-deltas { display: flex; flex-wrap: wrap; gap: 4px; }
.alims-tool-callout { display: flex; align-items: flex-start; gap: 5px; padding: 6px 7px; border-radius: 7px; border: 1px solid var(--alims-warn-border); background: var(--alims-warn-bg); font-size: 9px; color: var(--alims-warn); }
.alims-tool-callout svg { flex: 0 0 auto; margin-top: 1px; }
.alims-tool-note { font-size: 8.5px; color: var(--dsw-alias-label-secondary); }
.alims-tool-error { font-size: 10px; color: var(--alims-err); background: var(--alims-err-bg); border: 1px solid var(--alims-err-border); border-radius: 6px; padding: 6px 7px; }
.alims-tool-raw { margin: 0; font-size: 9px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); max-height: 180px; overflow: auto; }
.alims-tool-pending { display: flex; align-items: center; gap: 6px; font-size: 10px; color: var(--dsw-alias-label-secondary); }
.alims-turn-cards { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 2px; }
.alims-turn-cards .alims-tool-card { max-width: 100%; }
.alims-overview-card { display: flex; flex-direction: column; gap: 6px; }
.alims-overview-scroll { overflow-x: auto; padding-bottom: 2px; }
.alims-overview-grid { display: grid; gap: 1px; min-width: 430px; background: var(--dsw-alias-border-l1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; overflow: hidden; }
.alims-overview-corner, .alims-overview-day, .alims-overview-label, .alims-overview-cell { background: var(--dsw-alias-bg-layer-1); padding: 3px 4px; }
.alims-overview-corner { display: flex; align-items: center; font-size: 8px; color: var(--dsw-alias-label-secondary); min-height: 34px; }
.alims-overview-day { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 34px; }
.alims-overview-day span { font-size: 8px; font-weight: 600; }
.alims-overview-day small { font-size: 7px; color: var(--dsw-alias-label-secondary); }
.alims-overview-label { display: flex; flex-direction: column; justify-content: center; gap: 1px; min-height: 44px; }
.alims-overview-label span { font-size: 8px; font-weight: 550; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-overview-label small { font-size: 7px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.alims-overview-cell { display: flex; flex-direction: column; gap: 2px; justify-content: center; min-height: 44px; padding: 2px; }
.alims-overview-bar { width: 100%; min-height: 34px; border-radius: 4px; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1.05; gap: 1px; overflow: hidden; padding: 1px 0; }
.alims-overview-bar span { font-size: 6px; font-weight: 650; white-space: nowrap; }
.alims-overview-bar small { font-size: 6px; opacity: .9; }
.alims-overview-footer { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 8px; color: var(--dsw-alias-label-secondary); }
.alims-overview-footer span { display: inline-flex; align-items: center; gap: 3px; }
.alims-overview-footer i { width: 5px; height: 5px; border-radius: 50%; display: inline-block; }
.alims-overview-note { font-style: italic; }
.alims-overview-missing { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; font-size: 8.5px; color: var(--dsw-alias-label-secondary); border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 5px; }
@keyframes alims-spin { to { transform: rotate(360deg); } }
@keyframes alims-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (max-width: 380px) {
  .alims-title-en, .alims-conn { display: none; }
  .alims-stat-value { font-size: 19px; }
  .alims-plan-card { flex-basis: 170px; }
}
`;

  window.__ModuleLoader__.load({
    id: '@local/agentic-lims',
    factory(require) {
      const React = require('react');
      const h = React.createElement;
      const { useState, useEffect, useMemo, useRef, useCallback } = React;

      const PKG = '@local/agentic-lims';
      const KIND = 'agentic-lims';
      const MENU = [
        { id: 'dashboard', label: '概览', icon: 'grid' },
        { id: 'projects', label: '项目', icon: 'layer' },
        { id: 'tasks', label: '任务', icon: 'list' },
        { id: 'schedule', label: '排程', icon: 'calendar' },
        { id: 'impact', label: '影响', icon: 'alert' },
        { id: 'resources', label: '资源', icon: 'cube' },
        { id: 'analytics', label: '分析', icon: 'chart' },
        { id: 'audit', label: '审计', icon: 'clock' },
      ];
      const ROLES = {
        lab: { label: '实验人员', short: 'Lab', pages: ['dashboard', 'projects', 'tasks', 'schedule', 'resources', 'impact'], defaultPage: 'dashboard' },
        lead: { label: 'TM / TL', short: 'Lead', pages: ['dashboard', 'projects', 'tasks', 'schedule', 'impact', 'resources', 'analytics', 'audit'], defaultPage: 'schedule' },
        ops: { label: '运营负责人', short: 'Ops', pages: ['dashboard', 'projects', 'schedule', 'impact', 'resources', 'analytics', 'audit'], defaultPage: 'analytics' },
      };
      const PRIORITY = {
        Urgent: { label: '紧急', tone: 'error', rank: 0 },
        High: { label: '高', tone: 'warn', rank: 1 },
        Normal: { label: '普通', tone: 'brand', rank: 2 },
        Low: { label: '低', tone: 'idle', rank: 3 },
      };
      const PLAN_TONE = {
        feasible: { tone: 'ok', label: '可行' },
        at_risk: { tone: 'warn', label: '有风险' },
        needs_review: { tone: 'warn', label: '需审核' },
        blocked: { tone: 'error', label: '不可行' },
        confirmed: { tone: 'ok', label: '已确认' },
        superseded: { tone: 'idle', label: '已替代' },
      };
      const SEVERITY = {
        blocked: { tone: 'error', label: '阻塞' },
        late: { tone: 'error', label: '会延期' },
        delayed: { tone: 'warn', label: '推迟' },
        ok: { tone: 'ok', label: '可重排' },
      };

      // ---------------------------------------------------------------- helpers
      function cx(...values) {
        return values.filter(Boolean).join(' ');
      }

      async function api(path, options = {}) {
        const init = {
          method: options.method || 'GET',
          credentials: 'same-origin',
          headers: {},
        };
        if (options.body !== undefined) {
          init.headers['content-type'] = 'application/json';
          init.body = JSON.stringify(options.body);
        }
        const response = await fetch(path, init);
        let data = {};
        try {
          data = await response.json();
        } catch {
          data = {};
        }
        if (!response.ok || data.ok === false) {
          const error = new Error(data.error || `请求失败（HTTP ${response.status}）`);
          error.status = response.status;
          error.data = data;
          throw error;
        }
        return data;
      }

      function shift(value) {
        if (!value) return null;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        return new Date(date.getTime() + 8 * 3600 * 1000);
      }

      function pad(value) {
        return String(value).padStart(2, '0');
      }

      function fmtDate(value, withWeekday = false) {
        const date = shift(value);
        if (!date) return '—';
        const text = `${pad(date.getUTCMonth() + 1)}/${pad(date.getUTCDate())}`;
        if (!withWeekday) return text;
        return `${text} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getUTCDay()]}`;
      }

      function fmtTime(value) {
        const date = shift(value);
        if (!date) return '—';
        return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
      }

      function fmtDateTime(value) {
        const date = shift(value);
        if (!date) return '—';
        return `${fmtDate(value)} ${fmtTime(value)}`;
      }

      function fmtRange(start, end) {
        if (!start || !end) return '—';
        const sameDay = fmtDate(start) === fmtDate(end);
        return sameDay ? `${fmtDate(start)} ${fmtTime(start)}–${fmtTime(end)}` : `${fmtDateTime(start)} → ${fmtDateTime(end)}`;
      }

      function addDayKey(dayKey, days) {
        const date = new Date(`${dayKey}T12:00:00+08:00`);
        date.setDate(date.getDate() + days);
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
      }

      function diffDayKeys(first, last) {
        const start = new Date(`${first}T12:00:00+08:00`);
        const end = new Date(`${last}T12:00:00+08:00`);
        return Math.round((end.getTime() - start.getTime()) / 86400000);
      }

      function fmtHours(value) {
        const number = Number(value) || 0;
        return `${Math.round(number * 10) / 10}h`;
      }

      function fmtMargin(hours) {
        if (hours === null || hours === undefined) return '—';
        const value = Math.round(hours);
        if (value >= 0) return `提前 ${value}h`;
        return `延期 ${Math.abs(value)}h`;
      }

      function pct(value, max) {
        if (!max) return 0;
        return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
      }

      function toneStyle(tone) {
        if (tone === 'ok') return { color: 'var(--alims-ok)', background: 'var(--alims-ok-bg)', borderColor: 'var(--alims-ok-border)' };
        if (tone === 'warn') return { color: 'var(--alims-warn)', background: 'var(--alims-warn-bg)', borderColor: 'var(--alims-warn-border)' };
        if (tone === 'error') return { color: 'var(--alims-err)', background: 'var(--alims-err-bg)', borderColor: 'var(--alims-err-border)' };
        if (tone === 'brand') return { color: 'var(--alims-brand)', background: 'var(--alims-brand-bg)', borderColor: 'var(--alims-brand-border)' };
        return { color: 'var(--dsw-alias-label-secondary)', background: 'var(--alims-idle-bg)', borderColor: 'var(--alims-idle-border)' };
      }

      function priorityInfo(priority) {
        return PRIORITY[priority] || PRIORITY.Normal;
      }

      function planInfo(plan) {
        return PLAN_TONE[plan.status] || { tone: 'idle', label: plan.statusLabel || plan.status || '—' };
      }

      function unique(values) {
        return [...new Set(values)];
      }

      // ------------------------------------------------------------------ icons
      const ICON_PATHS = {
        flask: 'M9 3h6M10 3v5.3L5.6 17a3 3 0 0 0 2.7 4.3h7.4a3 3 0 0 0 2.7-4.3L14 8.3V3M7.5 15h9',
        grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
        list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
        calendar: 'M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M8 13h3M13 13h3M8 17h3',
        cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5',
        chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
        spark: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
        alert: 'M12 4l9 16H3zM12 9v4M12 16h.01',
        check: 'M5 12l5 5L20 7',
        x: 'M6 6l12 12M18 6L6 18',
        people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 7.8M18 21a6 6 0 0 0-3-5.2',
        arrow: 'M5 12h14M13 6l6 6-6 6',
        chevron: 'M9 6l6 6-6 6',
        refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6',
        play: 'M8 5l11 7-11 7z',
        layer: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
        target: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
        dot: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
        info: 'M12 8h.01M11 12h1v5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z',
        download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
      };

      function Icon({ name, size = 14, style }) {
        const path = ICON_PATHS[name] || ICON_PATHS.dot;
        return h(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: { display: 'block', flex: '0 0 auto', ...style },
            'aria-hidden': true,
          },
          h('path', { d: path }),
        );
      }

      // -------------------------------------------------------------- primitives
      function Pill({ tone = 'idle', children, dot = false, style }) {
        return h(
          'span',
          { className: 'alims-pill', style: { ...toneStyle(tone), ...style } },
          dot ? h('span', { className: 'alims-pill-dot', style: { background: 'currentColor' } }) : null,
          children,
        );
      }

      function Card({ children, className, style, onClick }) {
        return h('div', { className: cx('alims-card', className), style, onClick }, children);
      }

      function SectionTitle({ title, meta, action }) {
        return h(
          'div',
          { className: 'alims-section-title' },
          h('div', { className: 'alims-section-heading' }, h('span', null, title), meta ? h('span', { className: 'alims-section-meta' }, meta) : null),
          action || null,
        );
      }

      function Bar({ value, tone = 'brand', height = 6, showTrack = true }) {
        return h(
          'div',
          { className: 'alims-bar', style: { height, background: showTrack ? 'var(--alims-track)' : 'transparent' } },
          h('div', { className: 'alims-bar-fill', style: { width: `${Math.max(0, Math.min(100, value))}%`, background: toneStyle(tone).color } }),
        );
      }

      function StatTile({ label, value, unit, foot, tone = 'brand', icon }) {
        return h(
          'div',
          { className: 'alims-stat' },
          h(
            'div',
            { className: 'alims-stat-top' },
            h('span', { className: 'alims-stat-label' }, label),
            icon ? h('span', { className: 'alims-stat-icon', style: { color: toneStyle(tone).color } }, h(Icon, { name: icon, size: 14 })) : null,
          ),
          h('div', { className: 'alims-stat-value' }, value, unit ? h('span', { className: 'alims-stat-unit' }, unit) : null),
          foot ? h('div', { className: 'alims-stat-foot' }, foot) : null,
        );
      }

      function Empty({ icon = 'spark', title, detail, action }) {
        return h(
          'div',
          { className: 'alims-empty' },
          h('div', { className: 'alims-empty-icon' }, h(Icon, { name: icon, size: 20 })),
          h('div', { className: 'alims-empty-title' }, title),
          detail ? h('div', { className: 'alims-empty-detail' }, detail) : null,
          action || null,
        );
      }

      function Loading({ label = '正在读取 MongoDB…' }) {
        return h('div', { className: 'alims-loading' }, h('span', { className: 'alims-spinner' }), h('span', null, label));
      }

      function ErrorBox({ message, onRetry }) {
        return h(
          'div',
          { className: 'alims-error' },
          h(Icon, { name: 'alert', size: 16 }),
          h('div', { className: 'alims-error-body' }, h('div', { className: 'alims-error-title' }, '读取失败'), h('div', { className: 'alims-error-detail' }, message)),
          onRetry ? h('button', { className: 'alims-btn alims-btn-ghost', onClick: onRetry }, '重试') : null,
        );
      }

      function Toast({ toast, onClose }) {
        useEffect(() => {
          if (!toast) return undefined;
          const timer = setTimeout(onClose, toast.duration || 5200);
          return () => clearTimeout(timer);
        }, [toast]);
        if (!toast) return null;
        return h(
          'div',
          { className: cx('alims-toast', `is-${toast.tone || 'info'}`) },
          h('div', { className: 'alims-toast-icon' }, h(Icon, { name: toast.tone === 'error' ? 'alert' : toast.tone === 'ok' ? 'check' : 'info', size: 15 })),
          h(
            'div',
            { className: 'alims-toast-body' },
            h('div', { className: 'alims-toast-title' }, toast.title),
            toast.detail ? h('div', { className: 'alims-toast-detail' }, toast.detail) : null,
          ),
          h('button', { className: 'alims-toast-close', onClick: onClose, 'aria-label': '关闭' }, h(Icon, { name: 'x', size: 12 })),
        );
      }

      // ------------------------------------------------------------- chat cards
      function ToolCard({ icon, title, subtitle, tone = 'brand', children }) {
        return h(
          'div',
          { className: 'alims-tool-card' },
          h(
            'div',
            { className: 'alims-tool-head' },
            h('span', { className: cx('alims-tool-icon', `is-${tone}`) }, h(Icon, { name: icon, size: 13 })),
            h('div', { className: 'alims-tool-head-text' }, h('div', { className: 'alims-tool-title' }, title), subtitle ? h('div', { className: 'alims-tool-sub' }, subtitle) : null),
            h('span', { className: 'alims-tool-badge' }, 'LIMS'),
          ),
          children,
        );
      }

      function ToolKpis({ items }) {
        return h(
          'div',
          { className: 'alims-tool-kpis' },
          items.map((item) =>
            h('div', { key: item.label, className: 'alims-tool-kpi' }, h('span', null, item.label), h('strong', null, item.value, item.unit ? h('small', null, item.unit) : null)),
          ),
        );
      }

      function ToolList({ rows }) {
        if (!rows || rows.length === 0) return h('div', { className: 'alims-muted' }, '没有记录。');
        return h('div', { className: 'alims-tool-list' }, rows);
      }

      function LimsToolView({ phase, block, toolName }) {
        if (phase !== 'result') {
          return h(
            'div',
            { className: 'alims-tool-card is-pending' },
            h(
              'div',
              { className: 'alims-tool-head' },
              h('span', { className: 'alims-tool-icon is-brand' }, h(Icon, { name: 'spark', size: 13 })),
              h('div', { className: 'alims-tool-head-text' }, h('div', { className: 'alims-tool-title' }, '智能实验室正在查询'), h('div', { className: 'alims-tool-sub' }, toolName)),
              h('span', { className: 'alims-tool-badge' }, 'LIMS'),
            ),
            h('div', { className: 'alims-tool-pending' }, h('span', { className: 'alims-spinner' }), '运行确定性引擎…'),
          );
        }
        const meta = block?.meta;
        if (meta && meta.kind === 'error') {
          return h(ToolCard, { icon: 'alert', title: 'LIMS 查询失败', subtitle: meta.tool, tone: 'error' }, h('div', { className: 'alims-tool-error' }, meta.error));
        }
        if (!meta) {
          const textContent = (block?.content ?? []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
          return h(ToolCard, { icon: 'flask', title: '智能实验室', subtitle: toolName }, h('pre', { className: 'alims-tool-raw' }, textContent || '已完成。'));
        }
        if (meta.kind === 'bookings') {
          const value = meta;
          return h(
            ToolCard,
            { icon: 'calendar', title: '设备预约数', subtitle: `${value.equipment.name} · ${value.dateLabel}`, tone: value.downtime ? 'warn' : 'brand' },
            h(ToolKpis, {
              items: [
                { label: '预约任务', value: value.count, unit: '个' },
                { label: '占用时长', value: value.totalHours, unit: 'h' },
                { label: '容量利用率', value: value.utilization, unit: '%' },
                { label: '停机', value: value.downtime ? '是' : '否' },
              ],
            }),
            h(
              'div',
              { className: 'alims-tool-progress' },
              h('div', { className: 'alims-tool-progress-fill', style: { width: `${Math.min(100, value.utilization)}%` } }),
            ),
            h(
              ToolList,
              { rows: (value.tasks ?? []).map((task) => h('div', { key: task.id, className: 'alims-tool-row' }, h('div', null, h('strong', null, task.name), h('span', null, `${task.id} · ${task.personNames.join('、') || '—'}`)), h(Pill, { tone: priorityInfo(task.priority).tone }, priorityInfo(task.priority).label), h('span', { className: 'alims-tool-row-value' }, `${task.hours}h`))) },
            ),
            h('div', { className: 'alims-tool-note' }, `工作时段 ${value.equipment.workHours} · 容量 ${value.capacity}h/日`),
          );
        }
        if (meta.kind === 'overview') {
          const value = meta;
          return h(
            ToolCard,
            { icon: 'grid', title: '实验室概览', subtitle: value.clock?.dateLabel || '' },
            h(ToolKpis, {
              items: [
                { label: '任务', value: value.stats?.totalTasks ?? 0, unit: '项' },
                { label: '紧急', value: value.stats?.urgentTasks ?? 0, unit: '项' },
                { label: '风险', value: value.stats?.riskTasks ?? 0, unit: '项' },
                { label: '设备可用', value: `${value.stats?.equipmentAvailable ?? 0}/${value.stats?.equipmentTotal ?? 0}` },
              ],
            }),
            h(
              ToolList,
              { rows: (value.alerts ?? []).map((alert, index) => h('div', { key: index, className: 'alims-tool-row' }, h('span', { className: 'alims-tool-dot is-warn' }), h('div', null, h('strong', null, alert.title), h('span', null, alert.detail)))) },
            ),
            h(
              ToolList,
              { rows: (value.tasks ?? []).map((task) => h('div', { key: task.id, className: 'alims-tool-row' }, h('div', null, h('strong', null, task.name), h('span', null, `${task.id} · ${task.dueLabel} · ${task.effortHours}h`)), h(Pill, { tone: task.review ? 'warn' : priorityInfo(task.priority).tone }, task.review ? '需审核' : priorityInfo(task.priority).label))) },
            ),
          );
        }
        if (meta.kind === 'downtime') {
          const impact = meta.impact;
          if (!impact?.found) return h(ToolCard, { icon: 'alert', title: '停机影响', subtitle: '没有找到设备', tone: 'error' });
          return h(
            ToolCard,
            { icon: 'alert', title: '停机影响分析', subtitle: `${impact.equipment.name} · ${impact.dateLabel} · ${impact.reason || '计划维护'}`, tone: 'warn' },
            h(ToolKpis, {
              items: [
                { label: '受影响', value: impact.summary.affected, unit: '项' },
                { label: '可重排', value: impact.summary.replannable, unit: '项' },
                { label: '完成推迟', value: impact.summary.delayed, unit: '项' },
                { label: '阻塞', value: impact.summary.blocked, unit: '项' },
              ],
            }),
            h(
              ToolList,
              { rows: (impact.tasks ?? []).map((entry) => h('div', { key: entry.task.id, className: 'alims-tool-row is-block' }, h('div', null, h('strong', null, entry.task.name), h('span', null, `${entry.task.id} · 原 ${entry.before.startLabel} → ${entry.before.endLabel}`), entry.recommended ? h('span', null, `建议 ${entry.recommended.startLabel} → ${entry.recommended.endLabel} · ${entry.recommended.resources.equipment.name} + ${entry.recommended.resources.person.name}`) : h('span', { className: 'is-late' }, '无法重排')), h(Pill, { tone: entry.severity === 'blocked' ? 'error' : entry.severity === 'late' ? 'error' : entry.severity === 'delayed' ? 'warn' : 'ok' }, entry.deltaHours === null ? entry.severity : `${entry.deltaHours > 0 ? '+' : ''}${entry.deltaHours}h`))) },
            ),
          );
        }
        if (meta.kind === 'plans') {
          return h(
            ToolCard,
            { icon: 'spark', title: '候选排程', subtitle: meta.task ? `${meta.task.id} · ${meta.task.name}` : '' },
            h(
              'div',
              { className: 'alims-tool-plans' },
              (meta.plans ?? []).map((plan) => h('div', { key: plan.id, className: 'alims-tool-plan' }, h('div', { className: 'alims-tool-plan-head' }, h('strong', null, plan.strategyLabel), h(Pill, { tone: plan.status === 'feasible' ? 'ok' : plan.status === 'at_risk' ? 'warn' : plan.status === 'needs_review' ? 'warn' : 'error' }, plan.statusLabel)), h('div', { className: 'alims-tool-plan-score' }, plan.score, h('small', null, '分')), h('div', { className: 'alims-tool-plan-meta' }, `${plan.startLabel} → ${plan.endLabel}`), h('div', { className: 'alims-tool-plan-meta' }, `${plan.resources?.equipment?.name ?? '—'} + ${plan.resources?.person?.name ?? '—'}`))),
            ),
            (meta.diagnostics ?? []).length > 0 ? h('div', { className: 'alims-tool-error' }, meta.diagnostics.map((item) => item.text).join('；')) : null,
          );
        }
        if (meta.kind === 'revision') {
          const comparison = meta.comparison;
          if (!comparison) return h(ToolCard, { icon: 'refresh', title: '重排', subtitle: meta.task?.name || '' }, h('div', { className: 'alims-muted' }, '没有旧方案可对比。'));
          const delta = comparison.completionDeltaHours;
          return h(
            ToolCard,
            { icon: 'refresh', title: '重排前后对比', subtitle: meta.task ? `${meta.task.id} · ${meta.task.name}` : '' },
            h(
              'div',
              { className: 'alims-tool-compare' },
              h('div', { className: 'alims-tool-compare-side' }, h('span', null, '变更前'), h('strong', null, `${comparison.before?.startLabel} → ${comparison.before?.endLabel}`), h('small', null, `${comparison.before?.resources?.equipment?.name} + ${comparison.before?.resources?.person?.name} · ${comparison.before?.score} 分`)),
              h('div', { className: 'alims-tool-compare-arrow' }, h(Icon, { name: 'arrow', size: 13 })),
              h('div', { className: 'alims-tool-compare-side is-after' }, h('span', null, '变更后'), comparison.after ? h('strong', null, `${comparison.after.startLabel} → ${comparison.after.endLabel}`) : h('strong', { className: 'is-late' }, '无可行方案'), comparison.after ? h('small', null, `${comparison.after.resources?.equipment?.name} + ${comparison.after.resources?.person?.name} · ${comparison.after.score} 分`) : null),
            ),
            h(
              'div',
              { className: 'alims-tool-deltas' },
              h(Pill, { tone: delta === null || delta === 0 ? 'idle' : delta > 0 ? 'warn' : 'ok' }, delta === null ? '完成时间 —' : `完成 ${delta > 0 ? '+' : ''}${delta}h`),
              h(Pill, { tone: comparison.scoreDelta > 0 ? 'ok' : comparison.scoreDelta < 0 ? 'warn' : 'idle' }, `评分 ${comparison.scoreDelta > 0 ? '+' : ''}${comparison.scoreDelta}`),
              comparison.lateAfter ? h(Pill, { tone: 'error' }, '新方案晚于交期') : null,
            ),
            (comparison.resourceChanges ?? []).length > 0
              ? h(ToolList, { rows: comparison.resourceChanges.map((change) => h('div', { key: change.role, className: 'alims-tool-row' }, h('span', { className: 'alims-tool-dot' }), h('div', null, h('strong', null, change.label), h('span', null, `${change.from || '—'} → ${change.to || '—'}`)))) })
              : null,
          );
        }
        if (meta.kind === 'analytics') {
          return h(
            ToolCard,
            { icon: 'chart', title: '资源与瓶颈', subtitle: `未来 ${meta.windowDays ?? 14} 天` },
            h(ToolKpis, {
              items: [
                { label: '综合利用率', value: meta.summary?.equipmentUtilization ?? 0, unit: '%' },
                { label: '风险任务', value: meta.summary?.tasksAtRisk ?? 0, unit: '项' },
                { label: '不可用设备', value: meta.summary?.blockedEquipment ?? 0, unit: '台' },
              ],
            }),
            meta.bottleneck ? h('div', { className: 'alims-tool-callout' }, h(Icon, { name: 'target', size: 13 }), meta.bottleneck.text) : null,
            h(ToolList, { rows: (meta.riskTasks ?? []).map((task) => h('div', { key: task.id, className: 'alims-tool-row' }, h('div', null, h('strong', null, task.name), h('span', null, `${task.id} · ${task.daysLeft} 天后到期 · 负载 ${task.loadPct}%`)), h(Pill, { tone: task.level === 'high' ? 'error' : 'warn' }, task.level === 'high' ? '高' : '中'))) }),
          );
        }
        if (meta.kind === 'projects') {
          return h(
            ToolCard,
            { icon: 'layer', title: '项目', subtitle: `${meta.projects?.length ?? 0} 个项目` },
            h(ToolList, { rows: (meta.projects ?? []).map((project) => h('div', { key: project.id, className: 'alims-tool-row' }, h('div', null, h('strong', null, project.name), h('span', null, `${project.id} · ${project.taskCount} 个任务 · ${project.effortHours}h · ${project.dueFromLabel}–${project.dueToLabel}`)), h(Pill, { tone: project.riskCount > 0 ? 'warn' : 'ok' }, `${project.testPlanCount} 个计划`))) }),
          );
        }
        if (meta.kind === 'project') {
          return h(
            ToolCard,
            { icon: 'layer', title: meta.project?.name || '项目', subtitle: `${meta.project?.id || ''} · ${meta.project?.taskCount || 0} 个任务` },
            h(ToolList, { rows: (meta.groups ?? []).map((group) => h('div', { key: group.key, className: 'alims-tool-row is-block' }, h('div', null, h('strong', null, group.templateName), h('span', null, `${group.methodCode} · ${group.tasks.length} 个任务 · ${group.effortHours}h`), h('span', null, group.tasks.map((task) => task.id).join('、'))))) }),
          );
        }
        if (meta.kind === 'testplan') {
          const plan = meta.testPlan;
          if (!plan) return h(ToolCard, { icon: 'layer', title: '测试计划', subtitle: '没有可排任务', tone: 'warn' }, h('div', { className: 'alims-muted' }, (meta.diagnostics ?? []).map((item) => item.text).join('；')));
          return h(
            ToolCard,
            { icon: 'layer', title: '测试计划', subtitle: `${plan.projectName} · ${plan.templateName}` },
            h(ToolKpis, {
              items: [
                { label: '已排/总任务', value: `${plan.summary.scheduled}/${plan.summary.taskCount}` },
                { label: '总工时', value: plan.totalHours, unit: 'h' },
                { label: '晚于交期', value: plan.summary.late, unit: '项' },
                { label: '阻塞', value: plan.summary.unscheduled, unit: '项' },
              ],
            }),
            h(TestPlanTimeline, { testPlan: plan }),
          );
        }
        if (meta.kind === 'resource') {
          return h(
            ToolCard,
            { icon: 'cube', title: '资源可用性', subtitle: meta.resource?.name || '', tone: meta.usable ? 'ok' : 'warn' },
            h('div', { className: 'alims-tool-deltas' }, h(Pill, { tone: meta.usable ? 'ok' : 'error' }, meta.usable ? '当前可用' : '当前不可用')),
            h(ToolList, { rows: (meta.reasons ?? []).map((reason, index) => h('div', { key: index, className: 'alims-tool-row' }, h('span', { className: 'alims-tool-dot is-warn' }), h('div', null, h('span', null, reason)))) }),
            (meta.alternatives ?? []).length > 0 ? h(ToolList, { rows: meta.alternatives.map((item) => h('div', { key: item.id, className: 'alims-tool-row' }, h('div', null, h('strong', null, item.name), h('span', null, `${item.id} · ${item.status} · ${item.note || ''}`)))) }) : null,
          );
        }
        if (meta.kind === 'tasks' || meta.kind === 'task') {
          const list = meta.kind === 'tasks' ? meta.tasks : meta.task ? [meta.task] : [];
          return h(
            ToolCard,
            { icon: 'list', title: meta.kind === 'tasks' ? '任务列表' : '任务详情', subtitle: meta.kind === 'tasks' ? `${meta.total ?? list.length} 项` : meta.task?.id || '' },
            h(ToolList, { rows: list.map((task) => h('div', { key: task.id, className: 'alims-tool-row' }, h('div', null, h('strong', null, task.name), h('span', null, `${task.id} · ${task.dueLabel} · ${task.effortHours}h`)), h(Pill, { tone: task.review || task.readiness === 'needs_review' ? 'warn' : priorityInfo(task.priority).tone }, task.review || task.readiness === 'needs_review' ? '需审核' : priorityInfo(task.priority).label))) }),
          );
        }
        if (meta.kind === 'confirm') {
          return h(ToolCard, { icon: 'check', title: '排程已模拟确认', subtitle: meta.plan?.id || '', tone: 'ok' }, h('div', { className: 'alims-tool-note' }, `${meta.plan?.resources?.equipment?.name} + ${meta.plan?.resources?.person?.name} · ${meta.plan?.startLabel} → ${meta.plan?.endLabel}`));
        }
        if (meta.kind === 'simulate') {
          return h(
            ToolCard,
            { icon: 'chart', title: '情景模拟', subtitle: `+${meta.scenario?.addCount ?? 1} 台 ${meta.scenario?.equipmentType ?? ''}` },
            h(ToolKpis, { items: [{ label: '新增产能', value: meta.scenario?.extraCapacity ?? 0, unit: 'h' }, { label: '受影响任务', value: meta.scenario?.affectedTasks ?? 0, unit: '项' }, { label: '延期风险', value: `${meta.scenario?.delayRiskBefore ?? 0} → ${meta.scenario?.delayRiskAfter ?? 0}` }] }),
            h('div', { className: 'alims-tool-note' }, meta.scenario?.note || ''),
          );
        }
        return h(ToolCard, { icon: 'flask', title: '智能实验室', subtitle: toolName }, h('pre', { className: 'alims-tool-raw' }, JSON.stringify(meta, null, 2).slice(0, 2000)));
      }

      // -------------------------------------------------- answer-level chat cards
      /**
       * Cards under the closing answer.
       *
       * DSH folds a finished turn's process group (thinking + tool calls) into a
       * single header line, so a card that only lives in the tool group is gone
       * from the transcript the moment the answer lands. `conversation.chat.turnTail`
       * renders outside that group, beneath the closing prose, and stays visible.
       * The Turn Definition below projects every settled `lims_*` result against
       * its turn; the tail renders the collected cards.
       */
      const LIMS_TOOL_NAMES = [
        'lims_overview',
        'lims_equipment_bookings',
        'lims_list_tasks',
        'lims_get_task',
        'lims_generate_plans',
        'lims_revise_plan',
        'lims_confirm_plan',
        'lims_explain_resource',
        'lims_analyze_bottlenecks',
        'lims_simulate_capacity',
        'lims_analyze_downtime',
        'lims_list_projects',
        'lims_get_project',
        'lims_generate_test_plan',
      ];
      const LIMS_ANSWER_CARD_KEY = 'lims-answer-cards';
      const SURFACE_EVENT_TYPES = new Set(['system/message', 'developer/message', 'user/message', 'assistant/message', 'tool/result']);

      function isAppendSurfaceEvent(event) {
        return Boolean(event) && SURFACE_EVENT_TYPES.has(event.type) && event.surfaceOp === 'append';
      }

      const limsTurnDefinition = {
        kind: LIMS_ANSWER_CARD_KEY,
        match(event) {
          if (!event) return null;
          if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' };
          if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' };
          if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' };
          return null;
        },
        start(_context, match) {
          return { turn: match.event.data.turn, calls: new Map(), cards: [] };
        },
        update(context, match) {
          const state = context.state;
          if (!state) return state;
          if (match.event.type === 'tool/call') {
            if (!LIMS_TOOL_NAMES.includes(match.event.data.name)) return state;
            const calls = new Map(state.calls);
            calls.set(String(match.event.data.callId), match.event.data.name);
            return { ...state, calls };
          }
          if (match.event.type !== 'tool/result') return state;
          const message = match.event.data.message;
          const callId = message?.source?.callId === undefined ? '' : String(message.source.callId);
          const toolName = state.calls.get(callId);
          if (!toolName || message.isError === true) return state;
          const meta = match.event.data.meta;
          if (!meta || typeof meta !== 'object' || meta.kind === 'error') return state;
          const cards = state.cards.filter((card) => card.callId !== callId);
          cards.push({ callId, toolName, meta, seq: match.event.seq });
          return { ...state, cards };
        },
        buildLocationData(context, scope, previous) {
          if (scope !== 'turn' || !context.state) return null;
          const cards = context.state.cards;
          if (previous && previous.kind === 'turn' && previous.turn === context.state.turn && previous.key === LIMS_ANSWER_CARD_KEY && previous.value.cards === cards) return previous;
          return { kind: 'turn', turn: context.state.turn, key: LIMS_ANSWER_CARD_KEY, value: { cards } };
        },
      };

      /**
       * Pick the cards to show under one closing answer: keep settlement order,
       * one card per meta kind (latest wins) and at most three, so a turn that
       * queried several tasks does not turn the answer into a wall of cards.
       */
      function limsAnswerCards(owner) {
        const data = owner?.turn?.data?.get?.(LIMS_ANSWER_CARD_KEY);
        if (!data || !Array.isArray(data.cards)) return null;
        const end = owner.turn.end?.seq ?? owner.seq;
        const settled = data.cards.filter((card) => card.seq <= end);
        if (settled.length === 0) return null;
        const seen = new Set();
        const picked = [];
        for (let index = settled.length - 1; index >= 0; index -= 1) {
          const card = settled[index];
          if (seen.has(card.meta.kind)) continue;
          seen.add(card.meta.kind);
          picked.unshift(card);
          if (picked.length >= 3) break;
        }
        /* A bare task lookup is context for a richer card, not an answer of its own. */
        const substantive = picked.filter((card) => card.meta.kind !== 'task' && card.meta.kind !== 'tasks');
        return substantive.length > 0 ? substantive : picked;
      }

      function LimsAnswerCards(props) {
        const cards = limsAnswerCards(props);
        if (!cards) return null;
        return h(
          'div',
          { className: 'alims-turn-cards' },
          cards.map((card) => h(LimsToolView, { key: card.callId, phase: 'result', toolName: card.toolName, block: { meta: card.meta, content: [] } })),
        );
      }

      // ------------------------------------------------------------------ header
      function TopBar({ page, setPage, connected, workspace, role, onRoleChange, menuItems }) {
        return h(
          'div',
          { className: 'alims-top' },
          h(
            'div',
            { className: 'alims-brand' },
            h('div', { className: 'alims-logo' }, h(Icon, { name: 'flask', size: 15 })),
            h(
              'div',
              { className: 'alims-brand-text' },
              h('div', { className: 'alims-title' }, '智能实验室', h('span', { className: 'alims-title-en' }, 'Agentic LIMS')),
              h('div', { className: 'alims-sub' }, 'MongoDB · 确定性排程引擎 · MVP'),
            ),
            h('div', { className: 'alims-brand-spacer' }),
            h(
              'label',
              { className: 'alims-role', title: '切换角色视图' },
              h(Icon, { name: 'people', size: 12 }),
              h(
                'select',
                {
                  className: 'alims-role-select',
                  value: role,
                  onChange: (event) => onRoleChange(event.target.value),
                  'aria-label': '角色视图',
                },
                Object.entries(ROLES).map(([id, definition]) => h('option', { key: id, value: id }, definition.label)),
              ),
            ),
            h(
              'span',
              { className: cx('alims-conn', connected ? 'is-ok' : 'is-warn'), title: connected ? '通过 DSH 认证路由连接 MongoDB' : '正在连接后端' },
              h('span', { className: 'alims-conn-dot' }),
              connected ? 'Mongo 已连接' : '连接中',
            ),
          ),
          h(
            'div',
            { className: 'alims-menu', role: 'tablist' },
            menuItems.map((item) =>
              h(
                'button',
                {
                  key: item.id,
                  role: 'tab',
                  'aria-selected': page === item.id || (item.id === 'tasks' && page === 'task'),
                  className: cx('alims-menu-item', (page === item.id || (item.id === 'tasks' && page === 'task')) && 'is-active'),
                  onClick: () => setPage(item.id),
                },
                h(Icon, { name: item.icon, size: 13 }),
                h('span', null, item.label),
                item.id === 'schedule' && workspace?.page === 'schedule' && workspace?.message
                  ? h('span', { className: 'alims-menu-live', title: workspace.message })
                  : null,
              ),
            ),
          ),
        );
      }

      // --------------------------------------------------------------- dashboard
      function Timeline({ data, tasks, onOpenTask }) {
        if (!data) return null;
        const days = data.days || [];
        const bars = data.bars || [];
        const byId = new Map((tasks || []).map((task) => [task.id, task]));
        return h(
          'div',
          { className: 'alims-timeline' },
          h(
            'div',
            { className: 'alims-tl-head' },
            h('div', { className: 'alims-tl-label' }, '任务 / 交期'),
            h(
              'div',
              { className: 'alims-tl-days' },
              days.map((day, index) =>
                h(
                  'div',
                  { key: day.key, className: cx('alims-tl-day', index === 0 && 'is-today') },
                  h('span', { className: 'alims-tl-dlabel' }, day.label),
                  h('span', { className: 'alims-tl-wday' }, day.weekday.replace('周', '')),
                ),
              ),
            ),
          ),
          h(
            'div',
            { className: 'alims-tl-body' },
            bars.map((bar) => {
              const task = byId.get(bar.id) || {};
              const info = priorityInfo(task.priority);
              const tone = task.risk === 'high' ? 'error' : task.risk === 'medium' ? 'warn' : 'brand';
              const from = Math.max(0, bar.from < 0 ? 0 : bar.from);
              const to = Math.max(from, bar.to < 0 ? days.length - 1 : bar.to);
              return h(
                'div',
                { key: bar.id, className: 'alims-tl-row', onClick: () => onOpenTask(bar.id), title: `${bar.name}｜开始 ${bar.start}｜交期 ${bar.due}` },
                h('div', { className: 'alims-tl-label' }, h('span', { className: 'alims-tl-name' }, bar.name), h('span', { className: 'alims-tl-id' }, bar.id)),
                h(
                  'div',
                  { className: 'alims-tl-track' },
                  h('div', {
                    className: 'alims-tl-bar',
                    style: {
                      left: `${(from / days.length) * 100}%`,
                      width: `${((to - from + 1) / days.length) * 100}%`,
                      background: toneStyle(tone).background,
                      borderColor: toneStyle(tone).borderColor,
                      color: toneStyle(tone).color,
                    },
                  }, h('span', { className: 'alims-tl-bar-label' }, info.label)),
                ),
              );
            }),
          ),
        );
      }

      function TestPlanTimeline({ testPlan }) {
        const [weekOffset, setWeekOffset] = useState(0);
        useEffect(() => {
          setWeekOffset(0);
        }, [testPlan.id]);
        const days = testPlan.timeline?.days ?? [];
        const rows = testPlan.timeline?.rows ?? [];
        if (days.length === 0 || rows.length === 0) {
          return h(Empty, { icon: 'calendar', title: '测试计划还没有可展示的执行日', detail: '先为模板分组生成测试计划。' });
        }
        const dayByKey = new Map(days.map((day) => [day.key, day]));
        const firstDayKey = days[0].key;
        const lastDayKey = days[days.length - 1].key;
        const totalWeeks = Math.max(1, Math.ceil((diffDayKeys(firstDayKey, lastDayKey) + 1) / 7));
        const safeOffset = Math.min(weekOffset, totalWeeks - 1);
        const windowStart = addDayKey(firstDayKey, safeOffset * 7);
        const visibleDays = Array.from({ length: 7 }, (_, index) => {
          const key = addDayKey(windowStart, index);
          const existing = dayByKey.get(key);
          if (existing) return existing;
          const date = new Date(`${key}T12:00:00+08:00`);
          return {
            key,
            label: key.slice(5).replace('-', '/'),
            weekday: `周${['日', '一', '二', '三', '四', '五', '六'][date.getDay()]}`,
          };
        });
        const lookup = new Map();
        for (const row of rows) {
          for (const segment of row.segments) lookup.set(`${row.taskId}|${segment.day}`, segment);
        }
        return h(
          'div',
          { className: 'alims-testplan-timeline' },
          h(
            'div',
            { className: 'alims-gantt-pager' },
            h('span', { className: 'alims-gantt-range' }, `${visibleDays[0]?.label ?? ''}–${visibleDays[visibleDays.length - 1]?.label ?? ''}`),
            totalWeeks > 1
              ? h(
                  'div',
                  { className: 'alims-gantt-pager-actions' },
                  h('button', { className: 'alims-icon-btn', disabled: safeOffset === 0, title: '上一周', onClick: () => setWeekOffset((value) => Math.max(0, value - 1)) }, h(Icon, { name: 'chevron', size: 11, style: { transform: 'rotate(180deg)' } })),
                  h('span', null, `第 ${safeOffset + 1}/${totalWeeks} 周`),
                  h('button', { className: 'alims-icon-btn', disabled: safeOffset >= totalWeeks - 1, title: '下一周', onClick: () => setWeekOffset((value) => Math.min(totalWeeks - 1, value + 1)) }, h(Icon, { name: 'chevron', size: 11 })),
                )
              : h('span', { className: 'alims-gantt-weeklabel' }, '默认显示 1 周'),
          ),
          h(
            'div',
            { className: 'alims-testplan-grid', style: { gridTemplateColumns: `112px repeat(${visibleDays.length}, minmax(42px, 1fr))` } },
            h('div', { className: 'alims-testplan-corner' }, '任务 / 日期'),
            visibleDays.map((day) => h('div', { key: day.key, className: 'alims-testplan-day' }, h('span', null, day.label), h('small', null, day.weekday.replace('周', '')))),
            rows.map((row) =>
              [
                h('div', { key: `${row.taskId}-label`, className: 'alims-testplan-label' }, h('span', null, row.name), h('small', null, `${row.taskId} · ${row.segments.length} 天`)),
                ...visibleDays.map((day) => {
                  const segment = lookup.get(`${row.taskId}|${day.key}`);
                  const color = row.priority === 'Urgent' ? '#b91c1c' : row.priority === 'High' ? '#b45309' : row.priority === 'Low' ? '#475569' : '#1d4ed8';
                  return h(
                    'div',
                    { key: `${row.taskId}-${day.key}`, className: 'alims-testplan-cell' },
                    segment
                      ? h(
                          'div',
                          { className: 'alims-testplan-bar', style: { background: color, borderColor: color }, title: `${row.name} ${segment.start}-${segment.end}` },
                          h('span', null, segment.start),
                          h('span', null, segment.end),
                          h('small', null, `${segment.hours}h`),
                        )
                      : null,
                  );
                }),
              ],
            ),
          ),
        );
      }

      function ProjectsPage({ initialProjectId, initialTestPlanId, onOpenTask, showToast }) {
        const projects = useApi('/api/lims/projects');
        const [projectId, setProjectId] = useState(initialProjectId || null);
        const [testPlanId, setTestPlanId] = useState(initialTestPlanId || null);
        const [busyGroup, setBusyGroup] = useState(null);
        useEffect(() => {
          if (initialProjectId) {
            setProjectId(initialProjectId);
            setTestPlanId(initialTestPlanId || null);
          }
        }, [initialProjectId, initialTestPlanId]);
        const detail = useApi(projectId ? `/api/lims/project?projectId=${encodeURIComponent(projectId)}` : null);
        const project = detail.data;
        const testPlans = project?.testPlans ?? [];
        const selectedTestPlan = testPlans.find((plan) => plan.id === testPlanId) || testPlans[0] || null;

        const generate = async (group) => {
          setBusyGroup(group.key);
          try {
            const data = await api('/api/lims/test-plan', {
              method: 'POST',
              body: { projectId, templateId: group.key, actor: 'workspace' },
            });
            if (data.testPlan) {
              setTestPlanId(data.testPlan.id);
              showToast('测试计划已生成', 'ok', `${data.testPlan.templateName}：${data.testPlan.summary.scheduled}/${data.testPlan.summary.taskCount} 个任务已排入。`);
            } else {
              showToast('没有可排任务', 'error', (data.diagnostics || []).map((item) => item.text).join('；'));
            }
            detail.reload();
          } catch (error) {
            showToast('生成测试计划失败', 'error', error.message);
          } finally {
            setBusyGroup(null);
          }
        };

        if (!projectId) {
          if (projects.loading && !projects.data) return h('div', { className: 'alims-page' }, h(Loading, { label: '正在读取项目…' }));
          if (projects.error) return h('div', { className: 'alims-page' }, h(ErrorBox, { message: projects.error, onRetry: projects.reload }));
          const list = projects.data?.projects ?? [];
          return h(
            'div',
            { className: 'alims-page' },
            h(SectionTitle, { title: '项目', meta: `${list.length} 个项目 · 点击进入任务与测试计划` }),
            h(
              'div',
              { className: 'alims-project-list' },
              list.map((item) =>
                h(
                  'button',
                  { key: item.id, className: 'alims-project-card', onClick: () => { setProjectId(item.id); setTestPlanId(null); } },
                  h(
                    'div',
                    { className: 'alims-project-head' },
                    h('div', { className: 'alims-project-title' }, item.name),
                    h(Pill, { tone: priorityInfo(item.priority).tone }, priorityInfo(item.priority).label),
                  ),
                  h('div', { className: 'alims-project-code' }, `${item.id} · ${item.code}`),
                  h(
                    'div',
                    { className: 'alims-project-tags' },
                    h('span', { className: 'alims-tag' }, `${item.taskCount} 个任务`),
                    h('span', { className: 'alims-tag' }, `${item.effortHours}h`),
                    h('span', { className: 'alims-tag' }, `交期 ${item.dueFromLabel}–${item.dueToLabel}`),
                    item.riskCount > 0 ? h('span', { className: 'alims-tag is-risk' }, `${item.riskCount} 项关注`) : null,
                  ),
                  h('div', { className: 'alims-project-templates' }, (item.templateNames || []).map((name) => h(Pill, { key: name, tone: 'brand' }, name))),
                  h('div', { className: 'alims-project-foot' }, `${item.testPlanCount} 个测试计划`, h(Icon, { name: 'chevron', size: 12 })),
                ),
              ),
            ),
          );
        }

        if (detail.loading && !project) return h('div', { className: 'alims-page' }, h('button', { className: 'alims-back', onClick: () => setProjectId(null) }, '← 项目列表'), h(Loading, { label: '正在读取项目结构…' }));
        if (detail.error) return h('div', { className: 'alims-page' }, h('button', { className: 'alims-back', onClick: () => setProjectId(null) }, '← 项目列表'), h(ErrorBox, { message: detail.error, onRetry: detail.reload }));
        if (!project) return null;
        return h(
          'div',
          { className: 'alims-page' },
          h('button', { className: 'alims-back', onClick: () => setProjectId(null) }, '← 项目列表'),
          h(
            Card,
            { className: 'alims-project-hero' },
            h(
              'div',
              { className: 'alims-project-head' },
              h('div', null, h('div', { className: 'alims-project-title' }, project.project.name), h('div', { className: 'alims-project-code' }, `${project.project.id} · ${project.project.code}`)),
              h(Pill, { tone: priorityInfo(project.project.priority).tone }, priorityInfo(project.project.priority).label),
            ),
            h(
              'div',
              { className: 'alims-detail-metrics' },
              h('div', null, h('span', null, '任务'), h('strong', null, project.project.taskCount)),
              h('div', null, h('span', null, '总工作量'), h('strong', null, `${project.project.effortHours}h`)),
              h('div', null, h('span', null, '交期'), h('strong', null, `${project.project.dueFromLabel}–${project.project.dueToLabel}`)),
              h('div', null, h('span', null, '待审核'), h('strong', null, project.project.reviewCount)),
            ),
          ),
          h(
            'div',
            { className: 'alims-project-groups' },
            (project.groups || []).map((group) =>
              h(
                Card,
                { key: group.key, className: 'alims-project-group' },
                h(
                  'div',
                  { className: 'alims-project-group-head' },
                  h('div', null, h('div', { className: 'alims-project-group-title' }, group.templateName), h('div', { className: 'alims-project-group-sub' }, `${group.methodCode} · ${group.tasks.length} 个任务 · ${group.effortHours}h${group.reviewCount ? ` · ${group.reviewCount} 项待审核` : ''}`)),
                  h(
                    'button',
                    { className: 'alims-btn alims-btn-primary', disabled: busyGroup === group.key, onClick: () => generate(group) },
                    h(Icon, { name: busyGroup === group.key ? 'refresh' : 'layer', size: 12, style: busyGroup === group.key ? { animation: 'alims-spin 1s linear infinite' } : undefined }),
                    busyGroup === group.key ? '排程中…' : '生成测试计划',
                  ),
                ),
                h(
                  'div',
                  { className: 'alims-project-task-list' },
                  group.tasks.map((task) =>
                    h(
                      'button',
                      { key: task.id, className: 'alims-project-task', onClick: () => onOpenTask(task.id) },
                      h('span', { className: 'alims-project-task-name' }, task.name),
                      h('span', { className: 'alims-project-task-meta' }, `${task.id} · ${task.dueLabel} · ${task.effortHours}h`),
                      task.review ? h(Pill, { tone: 'warn' }, '需审核') : null,
                      h(Icon, { name: 'chevron', size: 11 }),
                    ),
                  ),
                ),
              ),
            ),
          ),
          testPlans.length > 0
            ? h(
                'div',
                { className: 'alims-project-testplans' },
                h(SectionTitle, { title: '测试计划', meta: `${testPlans.length} 个 · 多个任务按模板排成一组` }),
                testPlans.map((plan) =>
                  h(
                    Card,
                    { key: plan.id, className: cx('alims-testplan-card', plan.id === selectedTestPlan?.id && 'is-selected') },
                    h(
                      'div',
                      { className: 'alims-testplan-head' },
                      h('div', null, h('div', { className: 'alims-testplan-title' }, plan.templateName), h('div', { className: 'alims-testplan-sub' }, `${plan.id} · ${plan.startLabel} → ${plan.endLabel} · ${plan.totalHours}h`)),
                      h('div', { className: 'alims-chip-row' },
                        h(Pill, { tone: 'ok' }, `${plan.summary.scheduled}/${plan.summary.taskCount} 已排`),
                        plan.summary.late > 0 ? h(Pill, { tone: 'error' }, `${plan.summary.late} 项晚于交期`) : null,
                        plan.summary.unscheduled > 0 ? h(Pill, { tone: 'warn' }, `${plan.summary.unscheduled} 项阻塞`) : null,
                      ),
                    ),
                    h(TestPlanTimeline, { testPlan: plan }),
                    h(
                      'div',
                      { className: 'alims-testplan-actions' },
                      h('span', { className: 'alims-inline-note' }, '测试计划按项目/模板分组；每个任务的方案仍可单独进入排程页确认。'),
                      h('button', { className: 'alims-link', onClick: () => { setTestPlanId(plan.id); } }, '选中此计划'),
                    ),
                  ),
                ),
              )
            : null,
        );
      }

      function PersonalView({ tasks, onOpenTask, onNavigate }) {
        const resources = useApi('/api/lims/resources');
        const taskData = useApi('/api/lims/tasks');
        const [personId, setPersonId] = useState('P-003');
        if (resources.loading && !resources.data) return h(Loading, { label: '正在读取个人排程…' });
        const persons = resources.data?.persons ?? [];
        const person = persons.find((item) => item.id === personId) || persons[0];
        if (!person) return null;
        const days = (person.days || []).slice(0, 7);
        const taskLoad = days.reduce((total, day) => total + day.taskLoad, 0);
        const blocked = days.reduce((total, day) => total + day.blocked, 0);
        const allTasks = taskData.data?.tasks ?? tasks ?? [];
        const matching = allTasks
          .filter((task) => (task.qualifications || []).every((qualification) => (person.qualifications || []).includes(qualification)))
          .slice(0, 4);
        return h(
          Card,
          { className: 'alims-personal-view' },
          h(
            'div',
            { className: 'alims-personal-head' },
            h('div', null, h('div', { className: 'alims-personal-title' }, '我的下周安排'), h('div', { className: 'alims-personal-sub' }, `${person.name} · ${person.team} · ${person.workHours}`)),
            h(
              'select',
              { className: 'alims-select alims-select-sm', value: person.id, onChange: (event) => setPersonId(event.target.value), 'aria-label': '选择人员' },
              persons.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
            ),
          ),
          h(
            'div',
            { className: 'alims-personal-stats' },
            h('div', null, h('span', null, '未来 7 天工时'), h('strong', null, `${Math.round(taskLoad * 10) / 10}h`)),
            h('div', null, h('span', null, '会议/培训/休假'), h('strong', null, `${Math.round(blocked * 10) / 10}h`)),
            h('div', null, h('span', null, '可接任务'), h('strong', null, matching.length)),
          ),
          h(
            'div',
            { className: 'alims-personal-days' },
            days.map((day) => {
              const total = day.taskLoad + day.blocked;
              const tone = total > day.capacity ? 'error' : day.blocked > 0 ? 'warn' : 'brand';
              return h(
                'div',
                { key: day.day, className: 'alims-personal-day' },
                h('span', { className: 'alims-personal-day-label' }, fmtDate(`${day.day}T12:00:00+08:00`, true).replace(/^\d+\/\d+ /, '')),
                h('div', { className: 'alims-personal-day-bar' }, h(Bar, { value: pct(total, day.capacity), tone, height: 6 })),
                h('span', { className: 'alims-personal-day-value' }, `${Math.round(total * 10) / 10}h`),
              );
            }),
          ),
          (person.activities || []).length > 0
            ? h(
                'div',
                { className: 'alims-personal-activities' },
                person.activities.slice(0, 3).map((activity) =>
                  h('div', { key: activity.id, className: 'alims-activity' }, h(Pill, { tone: activity.impact === 'Full-day block' ? 'error' : 'warn' }, activity.type), h('span', { className: 'alims-activity-title' }, `${activity.title} · ${fmtDate(activity.start)}`)),
                ),
              )
            : null,
          h(
            'div',
            { className: 'alims-personal-tasks' },
            h('div', { className: 'alims-field-label' }, '资质匹配的可接任务'),
            matching.length === 0
              ? h('div', { className: 'alims-muted' }, '当前没有与资质完全匹配的任务。')
              : matching.map((task) =>
                  h(
                    'button',
                    { key: task.id, className: 'alims-personal-task', onClick: () => onOpenTask(task.id) },
                    h('span', null, task.name),
                    h('small', null, `${task.id} · ${task.dueLabel || fmtDate(task.dueDate, true)} · ${task.effortHours}h`),
                    h(Icon, { name: 'chevron', size: 11 }),
                  ),
                ),
          ),
          h('button', { className: 'alims-link', onClick: () => onNavigate('tasks') }, '查看全部任务 →'),
        );
      }

      function OpsFocus({ onNavigate }) {
        const analytics = useApi('/api/lims/analytics');
        if (analytics.loading && !analytics.data) return h(Card, { className: 'alims-ops-focus' }, h(Loading, { label: '正在读取运营指标…' }));
        const data = analytics.data;
        if (!data) return null;
        return h(
          Card,
          { className: 'alims-ops-focus' },
          h(
            'div',
            { className: 'alims-ops-head' },
            h('div', null, h('div', { className: 'alims-personal-title' }, '运营关注'), h('div', { className: 'alims-personal-sub' }, `未来 ${data.windowDays} 天 · 综合利用率 ${data.summary.equipmentUtilization}%`)),
            h(Pill, { tone: data.summary.tasksAtRisk > 0 ? 'warn' : 'ok', dot: true }, `${data.summary.tasksAtRisk} 项风险`),
          ),
          data.bottleneck ? h('div', { className: 'alims-ops-bottleneck' }, h(Icon, { name: 'target', size: 13 }), h('span', null, data.bottleneck.text)) : null,
          h(
            'div',
            { className: 'alims-ops-risks' },
            (data.riskTasks || []).slice(0, 3).map((task) =>
              h(
                'div',
                { key: task.id, className: 'alims-ops-risk' },
                h(Pill, { tone: task.level === 'high' ? 'error' : 'warn' }, task.level === 'high' ? '高' : '中'),
                h('div', null, h('strong', null, task.name), h('span', null, `${task.id} · ${task.daysLeft} 天后到期 · 负载 ${task.loadPct}%`)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'alims-agent-actions' },
            h('button', { className: 'alims-btn alims-btn-primary', onClick: () => onNavigate('analytics') }, '打开分析', h(Icon, { name: 'arrow', size: 12 })),
            h('button', { className: 'alims-btn alims-btn-ghost', onClick: () => onNavigate('impact') }, '停机影响'),
          ),
        );
      }

      function Dashboard({ overview, loading, error, reload, onNavigate, onOpenTask, onGenerate, onExplain, role, roleConfig }) {
        if (loading && !overview) return h(Loading, null);
        if (error && !overview) return h(ErrorBox, { message: error, onRetry: reload });
        if (!overview) return null;
        const stats = overview.stats || {};
        const tasks = overview.tasks || [];
        const alerts = overview.alerts || [];
        const equipment = [...(overview.equipment || [])].sort((a, b) => b.loadShare - a.loadShare);
        const top = [...tasks].sort((a, b) => {
          const risk = { high: 0, medium: 1, low: 2 };
          return (risk[a.risk] ?? 3) - (risk[b.risk] ?? 3) || (PRIORITY[a.priority]?.rank ?? 4) - (PRIORITY[b.priority]?.rank ?? 4);
        }).slice(0, 3);
        return h(
          'div',
          { className: 'alims-page' },
          h(
            'div',
            { className: 'alims-stats' },
            h(StatTile, { label: '待排任务', value: stats.openTasks, unit: '项', foot: `${stats.totalTasks} 项任务中`, tone: 'brand', icon: 'list' }),
            h(StatTile, { label: '需关注', value: stats.riskTasks, unit: '项', foot: `${stats.reviewTasks} 项待方法审核`, tone: 'warn', icon: 'alert' }),
            h(StatTile, { label: '设备可用', value: `${stats.equipmentAvailable}/${stats.equipmentTotal}`, foot: `${stats.spacesAvailable} 个空间可用`, tone: 'ok', icon: 'cube' }),
            h(StatTile, { label: '14 天负荷', value: stats.equipmentUtilization, unit: '%', foot: `${stats.totalLoadHours ?? 0}h 已占用`, tone: 'brand', icon: 'chart' }),
          ),
          role === 'lab' ? h(PersonalView, { tasks, onOpenTask, onNavigate }) : role === 'ops' ? h(OpsFocus, { onNavigate }) : null,
          h(
            Card,
            { className: 'alims-agent-card' },
            h(
              'div',
              { className: 'alims-agent-head' },
              h('div', { className: 'alims-agent-icon' }, h(Icon, { name: 'spark', size: 15 })),
              h('div', null, h('div', { className: 'alims-agent-title' }, 'Agent 协作入口'), h('div', { className: 'alims-agent-sub' }, '右侧对话已接入排程工具；说一句话，方案会出现在这里。')),
              h('div', { className: 'alims-agent-spacer' }),
              h(Pill, { tone: 'brand', dot: true }, '演示时钟 10/27 08:00'),
            ),
            h(
              'div',
              { className: 'alims-prompt' },
              h('span', { className: 'alims-prompt-quote' }, '“帮我安排 TASK-2005，优先保证交付日期，给我两个备选方案。”'),
            ),
            h(
              'div',
              { className: 'alims-agent-actions' },
              h('button', { className: 'alims-btn alims-btn-primary', onClick: () => onGenerate('TASK-2005') }, h(Icon, { name: 'play', size: 12 }), '生成 TASK-2005 方案'),
              h('button', { className: 'alims-btn alims-btn-ghost', onClick: () => onNavigate('schedule') }, '打开排程工作区', h(Icon, { name: 'arrow', size: 12 })),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '建议先处理', meta: '按风险与优先级', action: h('button', { className: 'alims-link', onClick: () => onNavigate('tasks') }, '全部任务') }),
            h(
              'div',
              { className: 'alims-focus-list' },
              top.map((task) =>
                h(
                  'div',
                  { key: task.id, className: 'alims-focus-row', onClick: () => onOpenTask(task.id) },
                  h('span', { className: cx('alims-prio-dot', `is-${priorityInfo(task.priority).tone}`) }),
                  h('div', { className: 'alims-focus-main' }, h('div', { className: 'alims-focus-name' }, task.name), h('div', { className: 'alims-focus-meta' }, `${task.id} · ${task.projectName} · ${fmtDate(task.dueDate, true)} 交期`)),
                  h(Pill, { tone: task.risk === 'high' ? 'error' : task.risk === 'medium' ? 'warn' : 'idle' }, task.risk === 'high' ? '高延误风险' : task.risk === 'medium' ? '需关注' : '正常'),
                  h(Icon, { name: 'chevron', size: 12, style: { color: 'var(--dsw-alias-label-secondary)' } }),
                ),
              ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '未来 16 天任务时间轴', meta: '点击任务查看详情', action: h('button', { className: 'alims-link', onClick: () => onNavigate('schedule') }, '去排程') }),
            h(Timeline, { data: overview.timeline, tasks, onOpenTask }),
          ),
          alerts.length > 0
            ? h(
                Card,
                null,
                h(SectionTitle, { title: '约束与风险提醒', meta: `${alerts.length} 条` }),
                h(
                  'div',
                  { className: 'alims-alert-list' },
                  alerts.map((alert, index) =>
                    h(
                      'div',
                      { key: index, className: cx('alims-alert', `is-${alert.level || 'warn'}`) },
                      h('span', { className: 'alims-alert-icon' }, h(Icon, { name: alert.level === 'error' ? 'alert' : 'info', size: 13 })),
                      h('div', { className: 'alims-alert-body' }, h('div', { className: 'alims-alert-title' }, alert.title), h('div', { className: 'alims-alert-detail' }, alert.detail)),
                      alert.resourceId
                        ? h('button', { className: 'alims-link', onClick: () => onExplain(alert.resourceId) }, '说明')
                        : alert.taskId
                          ? h('button', { className: 'alims-link', onClick: () => onOpenTask(alert.taskId) }, '查看')
                          : null,
                    ),
                  ),
                ),
              )
            : null,
          h(
            Card,
            null,
            h(SectionTitle, { title: '设备负荷', meta: '未来 14 天负荷占比', action: h('button', { className: 'alims-link', onClick: () => onNavigate('resources') }, '资源明细') }),
            h(
              'div',
              { className: 'alims-load-list' },
              equipment.slice(0, 5).map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'alims-load-row' },
                  h('div', { className: 'alims-load-name' }, h('span', null, item.name), h('span', { className: 'alims-load-id' }, item.id)),
                  h('div', { className: 'alims-load-bar' }, h(Bar, { value: item.loadShare, tone: item.blocked ? 'error' : 'brand', height: 7 })),
                  h('span', { className: 'alims-load-value' }, `${item.loadShare}%`),
                  h('span', { className: 'alims-load-hours' }, fmtHours(item.used)),
                ),
              ),
            ),
          ),
          h(
            Card,
            { className: 'alims-muted-card' },
            h(SectionTitle, { title: '最近操作', meta: 'MongoDB 审计流', action: h('button', { className: 'alims-link', onClick: () => onNavigate('audit') }, '全部审计') }),
            h(
              'div',
              { className: 'alims-audit-mini' },
              (overview.recentAudit || []).slice(0, 4).map((event) =>
                h(
                  'div',
                  { key: event.id, className: 'alims-audit-mini-row' },
                  h('span', { className: 'alims-audit-mini-dot' }),
                  h('span', { className: 'alims-audit-mini-summary' }, event.summary),
                  h('span', { className: 'alims-audit-mini-time' }, fmtDateTime(event.at)),
                ),
              ),
            ),
          ),
        );
      }

      // ------------------------------------------------------------------- tasks
      function TaskList({ tasks, onOpenTask }) {
        const [filter, setFilter] = useState('all');
        const filters = [
          { id: 'all', label: '全部', count: tasks.length },
          { id: 'urgent', label: '紧急', count: tasks.filter((task) => task.priority === 'Urgent').length },
          { id: 'review', label: '待审核', count: tasks.filter((task) => task.review).length },
          { id: 'risk', label: '有风险', count: tasks.filter((task) => task.risk !== 'low').length },
        ];
        const visible = tasks.filter((task) => {
          if (filter === 'urgent') return task.priority === 'Urgent';
          if (filter === 'review') return task.review;
          if (filter === 'risk') return task.risk !== 'low';
          return true;
        });
        return h(
          'div',
          { className: 'alims-page' },
          h(
            'div',
            { className: 'alims-filter-row' },
            filters.map((item) =>
              h(
                'button',
                { key: item.id, className: cx('alims-filter', filter === item.id && 'is-active'), onClick: () => setFilter(item.id) },
                item.label,
                h('span', { className: 'alims-filter-count' }, item.count),
              ),
            ),
          ),
          h(
            'div',
            { className: 'alims-task-list' },
            visible.map((task) =>
              h(
                'button',
                { key: task.id, className: 'alims-task-card', onClick: () => onOpenTask(task.id) },
                h('span', { className: cx('alims-task-stripe', `is-${priorityInfo(task.priority).tone}`) }),
                h(
                  'div',
                  { className: 'alims-task-main' },
                  h(
                    'div',
                    { className: 'alims-task-head' },
                    h('span', { className: 'alims-task-name' }, task.name),
                    h(Pill, { tone: priorityInfo(task.priority).tone }, priorityInfo(task.priority).label),
                    task.review ? h(Pill, { tone: 'warn' }, '需方法审核') : null,
                  ),
                  h('div', { className: 'alims-task-meta' }, `${task.id} · ${task.projectName} · ${task.testNo || '—'}`),
                  h(
                    'div',
                    { className: 'alims-task-tags' },
                    h('span', { className: 'alims-tag' }, h(Icon, { name: 'calendar', size: 11 }), `${fmtDate(task.dueDate, true)} 交期`),
                    h('span', { className: 'alims-tag' }, h(Icon, { name: 'clock', size: 11 }), fmtHours(task.effortHours)),
                    task.equipmentType ? h('span', { className: 'alims-tag' }, h(Icon, { name: 'cube', size: 11 }), task.equipmentType) : null,
                    h('span', { className: cx('alims-tag', task.risk === 'high' && 'is-risk') }, task.risk === 'high' ? `剩余 ${task.daysLeft} 天` : `剩余 ${task.daysLeft} 天`),
                  ),
                ),
                h(Icon, { name: 'chevron', size: 13, style: { color: 'var(--dsw-alias-label-secondary)' } }),
              ),
            ),
          ),
        );
      }

      function TaskDetail({ taskId, onBack, onGenerate, onExplain, refreshKey }) {
        const state = useApi(`/api/lims/task?taskId=${encodeURIComponent(taskId)}`, [refreshKey]);
        if (state.loading && !state.data) return h('div', { className: 'alims-page' }, h('button', { className: 'alims-back', onClick: onBack }, '← 返回任务'), h(Loading, null));
        if (state.error) return h('div', { className: 'alims-page' }, h('button', { className: 'alims-back', onClick: onBack }, '← 返回任务'), h(ErrorBox, { message: state.error, onRetry: state.reload }));
        const data = state.data;
        if (!data) return null;
        const task = data.task;
        const equipment = data.candidates?.equipment || [];
        const persons = data.candidates?.persons || [];
        const spaces = data.candidates?.spaces || [];
        return h(
          'div',
          { className: 'alims-page' },
          h(
            'div',
            { className: 'alims-detail-head' },
            h('button', { className: 'alims-back', onClick: onBack }, '← 返回任务'),
            h('span', { className: 'alims-detail-head-spacer' }),
            h(Pill, { tone: priorityInfo(task.priority).tone }, priorityInfo(task.priority).label),
            task.review ? h(Pill, { tone: 'warn' }, '需方法审核') : null,
          ),
          h(
            Card,
            { className: 'alims-detail-hero' },
            h('div', { className: 'alims-detail-title' }, task.name),
            h('div', { className: 'alims-detail-sub' }, `${task.id} · ${task.projectName}（${task.projectCode}）· Test No. ${task.testNo || '—'}`),
            h(
              'div',
              { className: 'alims-detail-metrics' },
              h('div', null, h('span', null, '交期'), h('strong', null, fmtDate(task.dueDate, true))),
              h('div', null, h('span', null, '预计工作量'), h('strong', null, fmtHours(task.effortHours))),
              h('div', null, h('span', null, '优先级'), h('strong', null, task.priority)),
              h('div', null, h('span', null, '状态'), h('strong', null, task.status)),
            ),
            h(
              'div',
              { className: 'alims-agent-actions' },
              h('button', { className: 'alims-btn alims-btn-primary', onClick: () => onGenerate(task.id) }, h(Icon, { name: 'spark', size: 12 }), '生成候选方案'),
              task.review ? h('span', { className: 'alims-inline-note' }, '非标准方法：方案会标记为“需审核”，不能直接确认') : null,
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '资源与规则要求', meta: task.templateName || '按任务字段推导' }),
            h(
              'div',
              { className: 'alims-kv-grid' },
              h('div', null, h('span', null, '检测方法'), h('strong', null, task.method)),
              h('div', null, h('span', null, '设备类型'), h('strong', null, task.equipmentType || '—')),
              h('div', null, h('span', null, '指定设备'), h('strong', null, (task.equipmentIds || []).join('、') || '—')),
              h('div', null, h('span', null, '资质'), h('strong', null, (task.qualifications || []).join('、') || '—')),
              h('div', null, h('span', null, '前处理空间'), h('strong', null, (task.spaceIds || []).join('、') || '—')),
              h('div', null, h('span', null, '准备时长'), h('strong', null, task.prepMinutes ? `${task.prepMinutes} min` : '—')),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '候选设备', meta: '硬约束预筛' }),
            h(
              'div',
              { className: 'alims-candidate-list' },
              equipment.map((item) =>
                h(
                  'div',
                  { key: item.id, className: cx('alims-candidate', !item.usable && 'is-blocked') },
                  h('div', { className: 'alims-candidate-main' }, h('div', { className: 'alims-candidate-name' }, `${item.name}`), h('div', { className: 'alims-candidate-meta' }, `${item.id} · ${item.type} · 校准至 ${item.calibrationDue || '—'}`)),
                  h(Pill, { tone: item.usable ? 'ok' : 'error' }, item.usable ? '可用' : item.status),
                  h('button', { className: 'alims-link', onClick: () => onExplain(item.id) }, '原因'),
                ),
              ),
              equipment.length === 0 ? h('div', { className: 'alims-muted' }, '没有匹配设备，需要补充设备要求。') : null,
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '候选人员', meta: '资质匹配' }),
            h(
              'div',
              { className: 'alims-candidate-list' },
              persons.map((person) =>
                h(
                  'div',
                  { key: person.id, className: 'alims-candidate' },
                  h('div', { className: 'alims-candidate-main' }, h('div', { className: 'alims-candidate-name' }, person.name), h('div', { className: 'alims-candidate-meta' }, `${person.id} · ${person.team} · ${(person.qualifications || []).join('、')}`)),
                  person.missing?.length ? h(Pill, { tone: 'warn' }, `缺 ${person.missing.join('、')}`) : h(Pill, { tone: 'ok' }, '资质满足'),
                ),
              ),
            ),
          ),
          spaces.length > 0
            ? h(
                Card,
                null,
                h(SectionTitle, { title: '前处理空间', meta: 'HC-006' }),
                h(
                  'div',
                  { className: 'alims-chip-row' },
                  spaces.map((space) => h(Pill, { key: space.id, tone: 'brand' }, `${space.name} · ${space.status}`)),
                ),
              )
            : null,
          h(
            Card,
            null,
            h(SectionTitle, { title: '现有负荷与相关活动', meta: `${(data.allocations || []).length} 条负荷` }),
            h(
              'div',
              { className: 'alims-mini-table' },
              (data.allocations || []).slice(0, 8).map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'alims-mini-row' },
                  h('span', null, item.date),
                  h('span', null, item.personId || item.resourceId || '—'),
                  h('span', null, item.type),
                  h('span', { className: 'alims-mini-value' }, fmtHours(item.load)),
                ),
              ),
              (data.allocations || []).length === 0 ? h('div', { className: 'alims-muted' }, '暂无已排负荷。') : null,
            ),
            (data.activities || []).length > 0
              ? h(
                  'div',
                  { className: 'alims-activity-list' },
                  data.activities.slice(0, 4).map((activity) =>
                    h(
                      'div',
                      { key: activity.id, className: 'alims-activity' },
                      h(Pill, { tone: activity.impact === 'Full-day block' ? 'error' : 'warn' }, activity.type),
                      h('span', { className: 'alims-activity-title' }, `${activity.title} · ${fmtRange(activity.start, activity.end)}`),
                    ),
                  ),
                )
              : null,
          ),
          (data.history || []).length > 0
            ? h(
                Card,
                { className: 'alims-muted-card' },
                h(SectionTitle, { title: '历史执行参考', meta: `${data.history.length} 个同类案例` }),
                h(
                  'div',
                  { className: 'alims-mini-table' },
                  data.history.slice(0, 6).map((item) =>
                    h(
                      'div',
                      { key: item.id, className: 'alims-mini-row' },
                      h('span', null, item.id),
                      h('span', null, item.note || item.finalStatus),
                      h('span', null, `${item.equipmentId || '—'} / ${item.personId || '—'}`),
                      h('span', { className: 'alims-mini-value' }, `${item.plannedMinutes}→${item.actualMinutes} min`),
                    ),
                  ),
                ),
                h('div', { className: 'alims-inline-note' }, '历史案例只作为估算参考；设备当前状态、校准与人员容量仍必须重新校验。'),
              )
            : null,
          (data.plans || []).length > 0
            ? h(
                Card,
                null,
                h(SectionTitle, { title: '已生成的方案', meta: `${data.plans.length} 个` }),
                h(
                  'div',
                  { className: 'alims-plan-mini-list' },
                  data.plans.map((plan) =>
                    h(
                      'button',
                      { key: plan.id, className: 'alims-plan-mini', onClick: () => onGenerate(task.id) },
                      h('span', { className: 'alims-plan-mini-id' }, plan.id),
                      h('span', { className: 'alims-plan-mini-strategy' }, plan.strategyLabel),
                      h(Pill, { tone: planInfo(plan).tone }, planInfo(plan).label),
                      h('span', { className: 'alims-plan-mini-score' }, `${plan.score} 分`),
                    ),
                  ),
                ),
              )
            : null,
        );
      }

      // ---------------------------------------------------------------- schedule
      function PlanCard({ plan, selected, onClick }) {
        const tone = planInfo(plan);
        return h(
          'button',
          { className: cx('alims-plan-card', selected && 'is-selected'), onClick },
          h(
            'div',
            { className: 'alims-plan-card-head' },
            h('div', null, h('span', { className: 'alims-plan-option' }, plan.optionLabel || 'A'), h('span', { className: 'alims-plan-strategy' }, plan.strategyLabel)),
            h(Pill, { tone: tone.tone }, tone.label),
          ),
          h('div', { className: 'alims-plan-score' }, plan.score, h('span', null, '分')),
          h('div', { className: 'alims-plan-card-time' }, fmtRange(plan.startAt, plan.endAt)),
          h(
            'div',
            { className: 'alims-plan-card-meta' },
            h('span', null, plan.resources?.equipment?.name || '—'),
            h('span', null, plan.resources?.person?.name || '—'),
            plan.resources?.space ? h('span', null, plan.resources.space.name) : null,
          ),
          h('div', { className: 'alims-plan-card-foot' }, h('span', { className: plan.dueMarginHours < 0 ? 'is-late' : 'is-ok' }, fmtMargin(plan.dueMarginHours)), h('span', null, `${plan.segments?.length || 0} 天`)),
        );
      }

      function PlanGantt({ plan }) {
        const [weekOffset, setWeekOffset] = useState(0);
        useEffect(() => {
          setWeekOffset(0);
        }, [plan.id]);
        const segments = plan.segments || [];
        if (segments.length === 0) return h(Empty, { title: '没有可展示的时段', detail: '该方案没有生成执行时段。' });
        const dayKeys = unique(segments.map((segment) => segment.day)).sort();
        const first = dayKeys[0];
        const last = dayKeys[dayKeys.length - 1];
        const totalDays = diffDayKeys(first, last) + 1;
        const totalWeeks = Math.max(1, Math.ceil(totalDays / 7));
        const safeOffset = Math.min(weekOffset, totalWeeks - 1);
        const windowStart = addDayKey(first, safeOffset * 7);
        const windowDays = Array.from({ length: 7 }, (_, index) => addDayKey(windowStart, index));
        const rows = [
          { key: 'equipment', label: plan.resources.equipment.name, sub: plan.resources.equipment.id, color: '#1d4ed8' },
          { key: 'person', label: plan.resources.person.name, sub: plan.resources.person.id, color: '#0f766e' },
        ];
        if (plan.resources.space) rows.push({ key: 'space', label: plan.resources.space.name, sub: plan.resources.space.id, color: '#b45309' });
        const lookup = new Map();
        for (const segment of segments) {
          for (const key of ['equipment', 'person', 'space']) {
            const id = key === 'equipment' ? segment.equipmentId : key === 'person' ? segment.personId : segment.spaceId;
            if (id) lookup.set(`${key}|${segment.day}`, segment);
          }
        }
        return h(
          'div',
          { className: 'alims-gantt' },
          h(
            'div',
            { className: 'alims-gantt-pager' },
            h('span', { className: 'alims-gantt-range' }, `${fmtDate(`${windowDays[0]}T12:00:00+08:00`)}–${fmtDate(`${windowDays[6]}T12:00:00+08:00`)}`),
            totalWeeks > 1
              ? h(
                  'div',
                  { className: 'alims-gantt-pager-actions' },
                  h('button', { className: 'alims-icon-btn', disabled: safeOffset === 0, title: '上一周', onClick: () => setWeekOffset((value) => Math.max(0, value - 1)) }, h(Icon, { name: 'chevron', size: 11, style: { transform: 'rotate(180deg)' } })),
                  h('span', null, `第 ${safeOffset + 1}/${totalWeeks} 周`),
                  h('button', { className: 'alims-icon-btn', disabled: safeOffset >= totalWeeks - 1, title: '下一周', onClick: () => setWeekOffset((value) => Math.min(totalWeeks - 1, value + 1)) }, h(Icon, { name: 'chevron', size: 11 })),
                )
              : h('span', { className: 'alims-gantt-weeklabel' }, '默认显示 1 周'),
          ),
          h(
            'div',
            { className: 'alims-gantt-grid', style: { gridTemplateColumns: '92px repeat(7, minmax(42px, 1fr))' } },
            h('div', { className: 'alims-gantt-corner' }, '资源 / 日期'),
            windowDays.map((day) => h('div', { key: day, className: 'alims-gantt-day' }, h('span', null, day.slice(5).replace('-', '/')), h('small', null, ['日', '一', '二', '三', '四', '五', '六'][new Date(`${day}T12:00:00+08:00`).getDay()]))),
            rows.map((row) =>
              [
                h('div', { key: `${row.key}-label`, className: 'alims-gantt-label' }, h('span', { className: 'alims-gantt-dot', style: { background: row.color } }), h('span', null, row.label), h('small', null, row.sub)),
                ...windowDays.map((day) => {
                  const segment = lookup.get(`${row.key}|${day}`);
                  if (!segment) return h('div', { key: `${row.key}-${day}`, className: 'alims-gantt-cell' });
                  return h(
                    'div',
                    { key: `${row.key}-${day}`, className: 'alims-gantt-cell' },
                    h(
                      'div',
                      {
                        className: 'alims-gantt-bar',
                        style: { background: row.color, borderColor: row.color },
                        title: `${segment.dateLabel} ${segment.start}-${segment.end}`,
                      },
                      h('span', { className: 'alims-gantt-bar-time' }, segment.start),
                      h('span', { className: 'alims-gantt-bar-time' }, segment.end),
                      h('small', null, `${segment.hours}h`),
                    ),
                  );
                }),
              ],
            ),
          ),
          h(
            'div',
            { className: 'alims-gantt-legend' },
            h('span', null, h('i', { style: { background: '#1d4ed8' } }), '设备'),
            h('span', null, h('i', { style: { background: '#0f766e' } }), '人员'),
            plan.resources.space ? h('span', null, h('i', { style: { background: '#b45309' } }), '空间') : null,
            h('span', { className: 'alims-gantt-assumption' }, '按每日剩余容量错峰；现有占用从工作时段起点扣减'),
          ),
        );
      }

      function ConstraintList({ evaluations }) {
        return h(
          'div',
          { className: 'alims-constraints' },
          (evaluations || []).map((item) =>
            h(
              'div',
              { key: item.constraintId, className: cx('alims-constraint', `is-${item.result}`) },
              h('span', { className: 'alims-constraint-icon' }, h(Icon, { name: item.result === 'pass' ? 'check' : item.result === 'fail' ? 'x' : 'alert', size: 12 })),
              h(
                'div',
                { className: 'alims-constraint-body' },
                h('div', { className: 'alims-constraint-name' }, item.name, h('span', { className: 'alims-constraint-code' }, item.constraintId)),
                h('div', { className: 'alims-constraint-text' }, item.explanation),
              ),
              h(Pill, { tone: item.result === 'pass' ? 'ok' : item.result === 'fail' ? 'error' : 'warn' }, item.result === 'pass' ? '通过' : item.result === 'fail' ? '失败' : '提示'),
            ),
          ),
        );
      }

      function PlanComparison({ comparison, onClose }) {
        if (!comparison) return null;
        const before = comparison.before;
        const after = comparison.after;
        const delta = comparison.completionDeltaHours;
        const scoreDelta = comparison.scoreDelta;
        const marginDelta = comparison.dueMarginDelta;
        return h(
          Card,
          { className: 'alims-compare-card' },
          h(SectionTitle, {
            title: '变更前后对比',
            meta: 'UC-03 · 确定性重排',
            action: h('button', { className: 'alims-link', onClick: onClose }, '关闭'),
          }),
          h(
            'div',
            { className: 'alims-compare-grid' },
            h(
              'div',
              { className: 'alims-compare-side' },
              h('div', { className: 'alims-compare-side-label' }, '变更前'),
              h('strong', null, `${before?.startLabel || '—'} → ${before?.endLabel || '—'}`),
              h('span', null, `${before?.resources?.equipment?.name || '—'} + ${before?.resources?.person?.name || '—'}${before?.resources?.space ? ` + ${before.resources.space.name}` : ''}`),
              h('span', null, `${before?.score ?? '—'} 分 · ${before?.statusLabel || '—'}`),
            ),
            h('div', { className: 'alims-compare-arrow' }, h(Icon, { name: 'arrow', size: 14 })),
            h(
              'div',
              { className: 'alims-compare-side is-after' },
              h('div', { className: 'alims-compare-side-label' }, '变更后'),
              after
                ? h(
                    React.Fragment,
                    null,
                    h('strong', null, `${after.startLabel} → ${after.endLabel}`),
                    h('span', null, `${after.resources?.equipment?.name || '—'} + ${after.resources?.person?.name || '—'}${after.resources?.space ? ` + ${after.resources.space.name}` : ''}`),
                    h('span', null, `${after.score} 分 · ${after.statusLabel}`),
                  )
                : h('span', { className: 'is-late' }, '没有找到满足全部约束的方案'),
            ),
          ),
          h(
            'div',
            { className: 'alims-compare-deltas' },
            h(Pill, { tone: delta === null || delta === 0 ? 'idle' : delta > 0 ? 'warn' : 'ok' }, delta === null ? '完成时间 —' : delta === 0 ? '完成时间不变' : `完成时间 ${delta > 0 ? '+' : ''}${delta}h`),
            h(Pill, { tone: scoreDelta === null || scoreDelta === 0 ? 'idle' : scoreDelta > 0 ? 'ok' : 'warn' }, scoreDelta === null ? '评分 —' : `评分 ${scoreDelta > 0 ? '+' : ''}${scoreDelta}`),
            h(Pill, { tone: marginDelta === null || marginDelta === 0 ? 'idle' : marginDelta > 0 ? 'ok' : 'warn' }, marginDelta === null ? '交期余量 —' : `交期余量 ${marginDelta > 0 ? '+' : ''}${marginDelta}h`),
            comparison.lateAfter === true ? h(Pill, { tone: 'error' }, '新方案晚于交期') : comparison.lateAfter === false ? h(Pill, { tone: 'ok' }, '新方案仍在交期内') : null,
          ),
          (comparison.resourceChanges || []).length > 0
            ? h(
                'div',
                { className: 'alims-compare-changes' },
                h('div', { className: 'alims-field-label' }, '资源变化'),
                comparison.resourceChanges.map((change) =>
                  h('div', { key: change.role, className: 'alims-compare-change' }, h('span', null, change.label), h('strong', null, `${change.from || '—'} → ${change.to || '—'}`)),
                ),
              )
            : null,
          (comparison.daysAdded || []).length > 0 || (comparison.daysRemoved || []).length > 0
            ? h(
                'div',
                { className: 'alims-compare-changes' },
                h('div', { className: 'alims-field-label' }, '执行日变化'),
                (comparison.daysAdded || []).length > 0 ? h('div', { className: 'alims-compare-change' }, h('span', null, '新增'), h('strong', { className: 'is-ok' }, comparison.daysAdded.join('、'))) : null,
                (comparison.daysRemoved || []).length > 0 ? h('div', { className: 'alims-compare-change' }, h('span', null, '移除'), h('strong', { className: 'is-late' }, comparison.daysRemoved.join('、'))) : null,
              )
            : null,
          (comparison.risksAdded || []).length > 0 || (comparison.risksRemoved || []).length > 0
            ? h(
                'div',
                { className: 'alims-compare-changes' },
                h('div', { className: 'alims-field-label' }, '风险变化'),
                (comparison.risksAdded || []).map((text, index) => h('div', { key: `add-${index}`, className: 'alims-compare-change is-warn' }, h('span', null, '新增'), h('strong', null, text))),
                (comparison.risksRemoved || []).map((text, index) => h('div', { key: `remove-${index}`, className: 'alims-compare-change' }, h('span', null, '消除'), h('strong', null, text))),
              )
            : null,
          h('div', { className: 'alims-inline-note' }, '旧方案已标记为“已替代”，不能再次确认；确认按钮只对最新方案生效。'),
        );
      }

      function ResourceScheduleGantt({ initialWeekStart }) {
        const [weekStart, setWeekStart] = useState(initialWeekStart || null);
        useEffect(() => {
          if (initialWeekStart) setWeekStart(initialWeekStart);
        }, [initialWeekStart]);
        const state = useApi(weekStart ? `/api/lims/resource-schedule?weekStart=${encodeURIComponent(weekStart)}` : '/api/lims/resource-schedule');
        if (state.loading && !state.data) return h(Card, { className: 'alims-overview-card' }, h(Loading, { label: '正在汇总多条排程…' }));
        if (state.error) return h(Card, { className: 'alims-overview-card' }, h(ErrorBox, { message: state.error, onRetry: state.reload }));
        const data = state.data;
        if (!data) return null;
        const days = data.days ?? [];
        const byResourceDay = new Map();
        for (const resource of data.resources ?? []) {
          for (const segment of resource.segments ?? []) {
            const key = `${resource.id}|${segment.day}`;
            if (!byResourceDay.has(key)) byResourceDay.set(key, []);
            byResourceDay.get(key).push(segment);
          }
        }
        const kindColor = { equipment: '#1d4ed8', person: '#0f766e', space: '#b45309' };
        return h(
          Card,
          { className: 'alims-overview-card' },
          h(SectionTitle, {
            title: '资源排程总览（多条）',
            meta: `本周 ${data.summary.schedules} 条 · 已有方案 ${data.summary.withPlan} 个任务 · 未生成 ${data.summary.withoutPlan}`,
          }),
          h(
            'div',
            { className: 'alims-gantt-pager' },
            h('span', { className: 'alims-gantt-range' }, data.weekLabel),
            h(
              'div',
              { className: 'alims-gantt-pager-actions' },
              h('button', { className: 'alims-icon-btn', title: '上一周', onClick: () => setWeekStart(addDayKey(data.weekStart, -7)) }, h(Icon, { name: 'chevron', size: 11, style: { transform: 'rotate(180deg)' } })),
              h('span', null, data.weekLabel),
              h('button', { className: 'alims-icon-btn', title: '下一周', onClick: () => setWeekStart(addDayKey(data.weekStart, 7)) }, h(Icon, { name: 'chevron', size: 11 })),
            ),
          ),
          (data.resources ?? []).length === 0
            ? h(Empty, { icon: 'calendar', title: '本周还没有已生成的排程', detail: '先为任务生成候选方案，或选择其他周。' })
            : h(
                'div',
                { className: 'alims-overview-scroll' },
                h(
                  'div',
                  { className: 'alims-overview-grid', style: { gridTemplateColumns: `112px repeat(${days.length}, minmax(42px, 1fr))` } },
                  h('div', { className: 'alims-overview-corner' }, '资源 / 日期'),
                  days.map((day) => h('div', { key: day.key, className: 'alims-overview-day' }, h('span', null, day.label), h('small', null, day.weekday.replace('周', '')))),
                  (data.resources ?? []).map((resource) =>
                    [
                      h('div', { key: `${resource.id}-label`, className: 'alims-overview-label' }, h('span', { className: 'alims-gantt-dot', style: { background: kindColor[resource.kind] ?? '#1d4ed8' } }), h('span', null, resource.name), h('small', null, `${resource.id} · ${resource.type}`)),
                      ...days.map((day) => {
                        const segments = byResourceDay.get(`${resource.id}|${day.key}`) ?? [];
                        return h(
                          'div',
                          { key: `${resource.id}-${day.key}`, className: 'alims-overview-cell' },
                          segments
                            .sort((a, b) => a.startMin - b.startMin)
                            .map((segment) =>
                              h(
                                'div',
                                {
                                  key: `${segment.planId}-${segment.day}`,
                                  className: 'alims-overview-bar',
                                  style: { background: kindColor[resource.kind] ?? '#1d4ed8' },
                                  title: `${segment.taskId} ${segment.taskName}｜${segment.start}–${segment.end}`,
                                },
                                h('span', null, segment.taskId),
                                h('span', null, `${segment.start}–${segment.end}`),
                                h('small', null, `${segment.hours}h`),
                              ),
                            ),
                        );
                      }),
                    ],
                  ),
                ),
              ),
          h(
            'div',
            { className: 'alims-overview-footer' },
            h('span', null, h('i', { style: { background: '#1d4ed8' } }), '设备'),
            h('span', null, h('i', { style: { background: '#0f766e' } }), '人员'),
            h('span', null, h('i', { style: { background: '#b45309' } }), '空间'),
            h('span', { className: 'alims-overview-note' }, data.note),
          ),
          (data.withoutPlanTasks ?? []).length > 0
            ? h(
                'div',
                { className: 'alims-overview-missing' },
                h('span', null, '尚未生成方案：'),
                data.withoutPlanTasks.map((task) => h(Pill, { key: task.id, tone: 'idle' }, `${task.id} ${task.priority}`)),
              )
            : null,
        );
      }

      function SchedulePage({ tasks, equipment, taskId, plans, selectedPlanId, comparison, onSelectTask, onGenerate, onRevise, onSelectPlan, onClearComparison, onConfirm, busy, toast }) {
        const [localTask, setLocalTask] = useState(taskId || 'TASK-2005');
        const autoTried = useRef(false);
        useEffect(() => {
          if (taskId) setLocalTask(taskId);
        }, [taskId]);
        useEffect(() => {
          if (plans.length === 0 && !autoTried.current && !busy) {
            autoTried.current = true;
            const initial = taskId || 'TASK-2005';
            setLocalTask(initial);
            onGenerate(initial);
          }
        }, []);
        const selected = plans.find((plan) => plan.id === selectedPlanId) || plans[0] || null;
        const task = tasks.find((item) => item.id === localTask) || tasks[0];
        const [avoidFriday, setAvoidFriday] = useState(false);
        const [preferredEquipment, setPreferredEquipment] = useState('');
        const [earliestStart, setEarliestStart] = useState('');
        return h(
          'div',
          { className: 'alims-page' },
          h(
            Card,
            { className: 'alims-schedule-toolbar' },
            h(
              'div',
              { className: 'alims-schedule-task' },
              h('label', { className: 'alims-field-label' }, '选择任务'),
              h(
                'select',
                { className: 'alims-select', value: localTask, onChange: (event) => { setLocalTask(event.target.value); onSelectTask(event.target.value); } },
                tasks.map((item) => h('option', { key: item.id, value: item.id }, `${item.id} · ${item.name}`)),
              ),
            ),
            h('div', { className: 'alims-schedule-actions' },
              h('button', { className: 'alims-btn alims-btn-primary', disabled: busy, onClick: () => onGenerate(localTask) }, h(Icon, { name: busy ? 'refresh' : 'spark', size: 12, style: busy ? { animation: 'alims-spin 1s linear infinite' } : undefined }), busy ? '计算中…' : '生成候选方案'),
            ),
          ),
          h(
            Card,
            { className: 'alims-revise-card' },
            h(SectionTitle, { title: '调整条件并重排', meta: '改约束 → 重新求解 → 前后对比' }),
            h(
              'div',
              { className: 'alims-revise-fields' },
              h(
                'label',
                { className: 'alims-revise-check' },
                h('input', {
                  type: 'checkbox',
                  checked: avoidFriday,
                  onChange: (event) => { setAvoidFriday(event.target.checked); onClearComparison?.(); },
                }),
                h('span', null, '周五下午不排实验'),
              ),
              h(
                'label',
                { className: 'alims-revise-field' },
                h('span', { className: 'alims-field-label' }, '优先设备'),
                h(
                  'select',
                  { className: 'alims-select', value: preferredEquipment, onChange: (event) => { setPreferredEquipment(event.target.value); onClearComparison?.(); } },
                  h('option', { value: '' }, '不指定'),
                  equipment.map((item) => h('option', { key: item.id, value: item.id }, `${item.id} · ${item.name}`)),
                ),
              ),
              h(
                'label',
                { className: 'alims-revise-field' },
                h('span', { className: 'alims-field-label' }, '最早开始'),
                h('input', { type: 'date', className: 'alims-select', value: earliestStart, onChange: (event) => { setEarliestStart(event.target.value); onClearComparison?.(); } }),
              ),
            ),
            h(
              'div',
              { className: 'alims-agent-actions' },
              h(
                'button',
                {
                  className: 'alims-btn alims-btn-primary',
                  disabled: busy,
                  onClick: () => onRevise(localTask, {
                    avoidFridayAfternoon: avoidFriday || undefined,
                    preferredEquipmentId: preferredEquipment || undefined,
                    earliestStart: earliestStart || undefined,
                  }, selected?.id),
                },
                h(Icon, { name: 'refresh', size: 12 }),
                selected ? '按新条件重排并对比' : '按条件生成并对比',
              ),
              h('span', { className: 'alims-inline-note' }, '重排会保留旧方案版本并标记为“已替代”，不可再确认。'),
            ),
          ),
          task?.review ? h('div', { className: 'alims-callout is-warn' }, h(Icon, { name: 'alert', size: 13 }), h('div', null, h('strong', null, '非标准方法'), '：该任务会产生“需审核”方案，确认按钮会被引擎拒绝，直到人工完成方法审核。')) : null,
          h(ResourceScheduleGantt, { initialWeekStart: selected?.segments?.[0]?.day }),
          plans.length === 0
            ? h(Empty, {
                icon: 'calendar',
                title: '还没有候选方案',
                detail: '选择一个任务并点击“生成候选方案”。引擎会先过滤硬约束，再按交期、负荷与偏好评分。',
                action: h('button', { className: 'alims-btn alims-btn-primary', onClick: () => onGenerate(localTask) }, '为当前任务生成'),
              })
            : h(
                'div',
                { className: 'alims-plan-strip' },
                plans.map((plan) => h(PlanCard, { key: plan.id, plan, selected: selected?.id === plan.id, onClick: () => onSelectPlan(plan.id) })),
              ),
          comparison ? h(PlanComparison, { comparison, onClose: onClearComparison }) : null,
          selected
            ? h(
                'div',
                { className: 'alims-plan-detail' },
                h(
                  Card,
                  { className: 'alims-plan-summary' },
                  h(
                    'div',
                    { className: 'alims-plan-summary-head' },
                    h('div', null, h('div', { className: 'alims-plan-summary-title' }, `${selected.id} · ${selected.strategyLabel}`), h('div', { className: 'alims-plan-summary-sub' }, `${selected.resources.equipment.name} + ${selected.resources.person.name}${selected.resources.space ? ` + ${selected.resources.space.name}` : ''}`)),
                    h(Pill, { tone: planInfo(selected).tone, dot: true }, planInfo(selected).label),
                  ),
                  h(
                    'div',
                    { className: 'alims-plan-kpis' },
                    h('div', null, h('span', null, '预计完成'), h('strong', null, fmtDateTime(selected.endAt))),
                    h('div', null, h('span', null, '交期余量'), h('strong', { className: selected.dueMarginHours < 0 ? 'is-late' : 'is-ok' }, fmtMargin(selected.dueMarginHours))),
                    h('div', null, h('span', null, '方案评分'), h('strong', null, `${selected.score} / 100`)),
                    h('div', null, h('span', null, '资源负荷'), h('strong', null, `设备 ${selected.utilization.equipment}% · 人员 ${selected.utilization.person}%`)),
                  ),
                  h(
                    'div',
                    { className: 'alims-score-bars' },
                    (selected.scoreBreakdown || []).map((item) =>
                      h(
                        'div',
                        { key: item.key, className: 'alims-score-row' },
                        h('span', null, item.label),
                        h('div', { className: 'alims-score-bar' }, h(Bar, { value: pct(item.value, item.max), tone: 'brand', height: 5 })),
                        h('span', { className: 'alims-score-value' }, `${item.value}/${item.max}`),
                      ),
                    ),
                  ),
                  h(
                    'div',
                    { className: 'alims-plan-actions' },
                    h('button', { className: 'alims-btn alims-btn-primary', disabled: busy || selected.status === 'confirmed' || selected.status === 'needs_review', onClick: () => onConfirm(selected.id) }, h(Icon, { name: selected.status === 'confirmed' ? 'check' : 'play', size: 12 }), selected.status === 'confirmed' ? '已模拟确认' : '确认并提交（模拟）'),
                    h('span', { className: 'alims-inline-note' }, '确认前会重新校验设备状态、人员容量与冲突；原型不写生产系统。'),
                  ),
                ),
                h(
                  Card,
                  null,
                  h(SectionTitle, { title: '当前方案资源明细（1 条）', meta: `只显示选中方案 · ${selected.segments.length} 个工作日 · 默认 7 天` }),
                  h(PlanGantt, { plan: selected }),
                  h(
                    'div',
                    { className: 'alims-segment-list' },
                    selected.segments.map((segment) =>
                      h(
                        'div',
                        { key: `${segment.day}-${segment.start}`, className: 'alims-segment' },
                        h('span', { className: 'alims-segment-date' }, segment.dateLabel),
                        h('span', { className: 'alims-segment-time' }, `${segment.start}–${segment.end}`),
                        h('span', { className: 'alims-segment-hours' }, `${segment.hours}h`),
                        h('span', { className: 'alims-segment-res' }, `${segment.equipmentName} / ${segment.personName}${segment.spaceName ? ` / ${segment.spaceName}` : ''}`),
                      ),
                    ),
                  ),
                ),
                h(
                  Card,
                  null,
                  h(SectionTitle, { title: '约束校验', meta: '硬约束优先，软目标只影响评分' }),
                  h(ConstraintList, { evaluations: selected.evaluations }),
                ),
                (selected.risks || []).length > 0
                  ? h(
                      Card,
                      { className: 'alims-muted-card' },
                      h(SectionTitle, { title: '风险与假设', meta: '来自引擎结果' }),
                      h(
                        'div',
                        { className: 'alims-risk-list' },
                        selected.risks.map((risk, index) =>
                          h('div', { key: index, className: cx('alims-risk', `is-${risk.level}`) }, h(Icon, { name: 'alert', size: 12 }), h('span', null, risk.text)),
                        ),
                      ),
                      h('ul', { className: 'alims-assumptions' }, (selected.assumptions || []).map((item, index) => h('li', { key: index }, item))),
                    )
                  : null,
              )
            : null,
        );
      }

      // ----------------------------------------------------------------- impact
      function ImpactPage({ initialEquipmentId, initialDate, onOpenTask, onGenerate, showToast }) {
        const resources = useApi('/api/lims/resources');
        const [equipmentId, setEquipmentId] = useState(initialEquipmentId || 'EQ-007');
        const [date, setDate] = useState(initialDate || '2026-10-28');
        const [reason, setReason] = useState('计划维护');
        const [impact, setImpact] = useState(null);
        const [busy, setBusy] = useState(false);
        const [error, setError] = useState(null);
        const [recorded, setRecorded] = useState(false);

        const load = useCallback(async (nextEquipmentId, nextDate) => {
          setBusy(true);
          setError(null);
          try {
            const data = await api(`/api/lims/impact?equipmentId=${encodeURIComponent(nextEquipmentId)}&date=${encodeURIComponent(nextDate)}`);
            setImpact(data.impact);
            setRecorded(Boolean(data.registered));
          } catch (failure) {
            setError(failure.message);
          } finally {
            setBusy(false);
          }
        }, []);

        useEffect(() => {
          if (initialEquipmentId) setEquipmentId(initialEquipmentId);
          if (initialDate) setDate(initialDate);
          if (initialEquipmentId && initialDate) load(initialEquipmentId, initialDate);
          else load('EQ-007', '2026-10-28');
        }, [initialEquipmentId, initialDate, load]);

        const equipment = resources.data?.equipment ?? [];
        const analyze = async () => {
          setBusy(true);
          setError(null);
          try {
            const data = await api('/api/lims/downtime', {
              method: 'POST',
              body: { equipmentId, date, reason, actor: 'workspace' },
            });
            setImpact(data.impact);
            setRecorded(true);
            showToast('已登记停机并完成影响分析', 'ok', data.workspace?.message || '');
          } catch (failure) {
            setError(failure.message);
          } finally {
            setBusy(false);
          }
        };
        const remove = async () => {
          setBusy(true);
          setError(null);
          try {
            await api(`/api/lims/downtime?equipmentId=${encodeURIComponent(equipmentId)}&date=${encodeURIComponent(date)}`, { method: 'DELETE' });
            setImpact(null);
            setRecorded(false);
            showToast('已撤销停机窗口', 'ok', '受影响任务将恢复为正常可用性。');
          } catch (failure) {
            setError(failure.message);
          } finally {
            setBusy(false);
          }
        };

        return h(
          'div',
          { className: 'alims-page' },
          h(
            Card,
            { className: 'alims-impact-form' },
            h(
              'div',
              { className: 'alims-impact-form-head' },
              h('div', null, h('div', { className: 'alims-impact-form-title' }, '设备停机影响分析'), h('div', { className: 'alims-impact-form-sub' }, '登记停机 → 找受影响任务 → 用确定性引擎重排 → 对比前后')),
              h(Pill, { tone: 'warn', dot: true }, '硬约束'),
            ),
            h(
              'div',
              { className: 'alims-impact-fields' },
              h(
                'label',
                { className: 'alims-impact-field' },
                h('span', { className: 'alims-field-label' }, '设备'),
                h(
                  'select',
                  { className: 'alims-select', value: equipmentId, onChange: (event) => { setEquipmentId(event.target.value); setImpact(null); setRecorded(false); } },
                  equipment.map((item) => h('option', { key: item.id, value: item.id }, `${item.id} · ${item.name}`)),
                ),
              ),
              h(
                'label',
                { className: 'alims-impact-field' },
                h('span', { className: 'alims-field-label' }, '停机日期'),
                h('input', { type: 'date', className: 'alims-select', value: date, onChange: (event) => { setDate(event.target.value); setImpact(null); setRecorded(false); } }),
              ),
              h(
                'label',
                { className: 'alims-impact-field' },
                h('span', { className: 'alims-field-label' }, '原因'),
                h(
                  'select',
                  { className: 'alims-select', value: reason, onChange: (event) => setReason(event.target.value) },
                  ['计划维护', '校准', '故障', '其他'].map((item) => h('option', { key: item, value: item }, item)),
                ),
              ),
            ),
            h(
              'div',
              { className: 'alims-agent-actions' },
              h('button', { className: 'alims-btn alims-btn-primary', disabled: busy, onClick: analyze }, h(Icon, { name: busy ? 'refresh' : 'alert', size: 12, style: busy ? { animation: 'alims-spin 1s linear infinite' } : undefined }), busy ? '分析中…' : '登记停机并分析'),
              impact ? h('button', { className: 'alims-btn alims-btn-ghost', onClick: () => load(equipmentId, date) }, '重新读取') : null,
              impact ? h('button', { className: 'alims-link', onClick: remove }, '撤销停机') : null,
            ),
            h('div', { className: 'alims-inline-note' }, '停机作为设备当日的硬可用性阻断写入 MongoDB；重排仍会检查人员资质、设备状态、校准与时间冲突。'),
            error ? h(ErrorBox, { message: error }) : null,
          ),
          impact
            ? h(
                'div',
                { className: 'alims-page', style: { padding: 0, gap: 8 } },
                h(
                  'div',
                  { className: 'alims-stats' },
                  h(StatTile, { label: '受影响任务', value: impact.summary.affected, unit: '项', foot: '当日占用该设备', tone: 'brand', icon: 'list' }),
                  h(StatTile, { label: '可重排', value: impact.summary.replannable, unit: '项', foot: '找到替代组合', tone: 'ok', icon: 'check' }),
                  h(StatTile, { label: '完成推迟', value: impact.summary.delayed, unit: '项', foot: `累计 ${impact.summary.delayHours}h；晚于交期 ${impact.summary.late} 项`, tone: impact.summary.delayHours > 0 ? 'warn' : 'ok', icon: 'alert' }),
                  h(StatTile, { label: '阻塞', value: impact.summary.blocked, unit: '项', foot: '无可行组合', tone: 'error', icon: 'x' }),
                ),
                h(
                  Card,
                  { className: 'alims-impact-hero' },
                  h(
                    'div',
                    { className: 'alims-impact-hero-head' },
                    h('div', null, h('div', { className: 'alims-impact-hero-title' }, impact.equipment.name), h('div', { className: 'alims-impact-hero-sub' }, `${impact.equipment.id} · ${impact.equipment.type} · ${impact.equipment.location} · 工作时段 ${impact.equipment.workHours}`)),
                    h(Pill, { tone: impact.equipment.status === 'Operational' ? 'warn' : 'error', dot: true }, `${impact.dateLabel} · ${impact.reason || '计划维护'}`),
                  ),
                  h('div', { className: 'alims-impact-hero-meta' }, `校准/维护到期：${impact.equipment.calibrationDue || '—'}｜已登记：${recorded ? '是' : '否'}｜影响任务：${impact.tasks.length}`),
                ),
                impact.tasks.length === 0
                  ? h(Empty, { icon: 'check', title: '该日期没有受影响任务', detail: '可以换一个设备或日期再分析；当前停机窗口仍已登记到 MongoDB。' })
                  : h(
                      'div',
                      { className: 'alims-impact-list' },
                      impact.tasks.map((entry) => {
                        const severity = SEVERITY[entry.severity] || SEVERITY.ok;
                        const beforeSegments = entry.before.segments.map((segment) => `${segment.day.slice(5).replace('-', '/')} ${segment.hours}h`).join(' · ');
                        return h(
                          Card,
                          { key: entry.task.id, className: 'alims-impact-task' },
                          h(
                            'div',
                            { className: 'alims-impact-task-head' },
                            h(
                              'div',
                              { className: 'alims-impact-task-main' },
                              h('div', { className: 'alims-impact-task-title' }, entry.task.name),
                              h('div', { className: 'alims-impact-task-meta' }, `${entry.task.id} · ${entry.task.projectName} · ${entry.task.priority} · 交期 ${entry.task.dueLabel} · ${entry.task.effortHours}h`),
                            ),
                            h(Pill, { tone: severity.tone, dot: true }, severity.label),
                          ),
                          h(
                            'div',
                            { className: 'alims-compare' },
                            h(
                              'div',
                              { className: 'alims-compare-row' },
                              h('span', { className: 'alims-compare-label' }, '原计划'),
                              h(
                                'div',
                                { className: 'alims-compare-main' },
                                h('strong', null, `${entry.before.startLabel || '—'} → ${entry.before.endLabel || '—'}`),
                                h('span', null, `${entry.before.dayCount} 天｜${beforeSegments || '无每日负荷'}`),
                              ),
                            ),
                            h(
                              'div',
                              { className: 'alims-compare-row is-after' },
                              h('span', { className: 'alims-compare-label' }, '建议'),
                              entry.recommended
                                ? h(
                                    'div',
                                    { className: 'alims-compare-main' },
                                    h('strong', null, `${entry.recommended.startLabel} → ${entry.recommended.endLabel}`),
                                    h('span', null, `${entry.recommended.resources.equipment.name} + ${entry.recommended.resources.person.name}${entry.recommended.resources.space ? ` + ${entry.recommended.resources.space.name}` : ''}`),
                                    h('span', null, (entry.recommended.segments ?? []).map((segment) => `${segment.day.slice(5).replace('-', '/')} ${segment.hours}h`).join(' · ')),
                                  )
                                : h('div', { className: 'alims-compare-blocked' }, entry.diagnostics.map((item) => item.text).join('；') || '没有找到可行组合'),
                            ),
                          ),
                          h(
                            'div',
                            { className: 'alims-impact-actions' },
                            h(
                              'span',
                              { className: entry.deltaHours > 0 ? 'is-late' : 'is-ok' },
                              entry.deltaHours === null ? '—' : entry.deltaHours > 0 ? `完成时间 +${entry.deltaHours}h` : entry.deltaHours < 0 ? `完成时间 ${entry.deltaHours}h` : '完成时间不变',
                            ),
                            entry.recommended
                              ? h('button', { className: 'alims-btn alims-btn-primary', onClick: () => onGenerate(entry.task.id) }, h(Icon, { name: 'calendar', size: 12 }), '去排程确认')
                              : null,
                            h('button', { className: 'alims-btn alims-btn-ghost', onClick: () => onOpenTask(entry.task.id) }, '任务详情'),
                          ),
                          (entry.recommended?.risks ?? []).length > 0
                            ? h(
                                'div',
                                { className: 'alims-impact-risks' },
                                entry.recommended.risks.map((risk, index) => h('span', { key: index, className: cx('alims-risk', `is-${risk.level}`) }, h(Icon, { name: 'alert', size: 11 }), risk.text)),
                              )
                            : null,
                        );
                      }),
                    ),
                h('div', { className: 'alims-disclaimer' }, '影响分析是原型估算：现有负荷只有每日小时数，前后时间按每日 08:00 起排展示；正式方案需使用分钟级资源日历。'),
              )
            : null,
        );
      }

      // ---------------------------------------------------------------- resources
      function ResourcePage({ explainId, onExplain, refreshKey }) {
        const state = useApi('/api/lims/resources', [refreshKey]);
        const [explain, setExplain] = useState(null);
        const [explainError, setExplainError] = useState(null);
        useEffect(() => {
          if (!explainId) {
            setExplain(null);
            return undefined;
          }
          let alive = true;
          setExplainError(null);
          api('/api/lims/explain', { method: 'POST', body: { resourceId: explainId } })
            .then((data) => alive && setExplain(data))
            .catch((error) => alive && setExplainError(error.message));
          return () => {
            alive = false;
          };
        }, [explainId, refreshKey]);
        if (state.loading && !state.data) return h('div', { className: 'alims-page' }, h(Loading, null));
        if (state.error) return h('div', { className: 'alims-page' }, h(ErrorBox, { message: state.error, onRetry: state.reload }));
        const data = state.data;
        if (!data) return null;
        return h(
          'div',
          { className: 'alims-page' },
          explainId
            ? h(
                Card,
                { className: 'alims-explain-card' },
                h(
                  'div',
                  { className: 'alims-explain-head' },
                  h('div', null, explain ? h('div', { className: 'alims-explain-title' }, explain.resource.name) : h('div', { className: 'alims-explain-title' }, explainId), h('div', { className: 'alims-explain-sub' }, explain ? `${explain.resource.id} · ${explain.resource.type} · ${explain.resource.location}` : '正在读取资源解释…')),
                  h('button', { className: 'alims-icon-btn', onClick: () => onExplain(null) }, h(Icon, { name: 'x', size: 12 })),
                ),
                explainError ? h(ErrorBox, { message: explainError }) : null,
                explain
                  ? h(
                      'div',
                      { className: 'alims-explain-body' },
                      h('div', { className: 'alims-explain-row' }, h('span', null, '结论'), h(Pill, { tone: explain.usable ? 'ok' : 'error' }, explain.usable ? '当前可用' : '当前不可用')),
                      h('div', { className: 'alims-explain-row' }, h('span', null, '状态'), h('strong', null, explain.resource.status)),
                      h('div', { className: 'alims-explain-row' }, h('span', null, '校准/维护'), h('strong', null, explain.resource.calibrationDue || '—')),
                      h('div', { className: 'alims-explain-row' }, h('span', null, '工作时间'), h('strong', null, explain.resource.workHours)),
                      h(
                        'div',
                        { className: 'alims-explain-reasons' },
                        (explain.reasons || []).map((reason, index) => h('div', { key: index, className: 'alims-explain-reason' }, h(Icon, { name: 'info', size: 12 }), h('span', null, reason))),
                      ),
                      (explain.alternatives || []).length > 0
                        ? h(
                            'div',
                            { className: 'alims-explain-alts' },
                            h('div', { className: 'alims-field-label' }, '同类型替代设备'),
                            explain.alternatives.map((item) => h('div', { key: item.id, className: 'alims-explain-alt' }, h('strong', null, item.name), h('span', null, `${item.id} · 校准至 ${item.calibrationDue || '—'} · ${item.note}`))),
                          )
                        : null,
                    )
                  : null,
              )
            : null,
          h(
            Card,
            null,
            h(SectionTitle, { title: '设备', meta: `${data.equipment.length} 台` }),
            h(
              'div',
              { className: 'alims-resource-list' },
              data.equipment.map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'alims-resource' },
                  h('span', { className: cx('alims-status-dot', item.status === 'Operational' ? 'is-ok' : 'is-warn') }),
                  h(
                    'div',
                    { className: 'alims-resource-main' },
                    h('div', { className: 'alims-resource-head' }, h('strong', null, item.name), h(Pill, { tone: item.status === 'Operational' ? 'ok' : 'warn' }, item.status)),
                    h('div', { className: 'alims-resource-meta' }, `${item.id} · ${item.type} · ${item.location} · 校准/维护至 ${item.calibrationDue || '—'}`),
                    h(
                      'div',
                      { className: 'alims-resource-load' },
                      h(Bar, { value: item.utilization, tone: item.status === 'Operational' ? 'brand' : 'error', height: 5 }),
                      h('span', null, `${item.utilization}% 容量 · ${fmtHours(item.used)} · 峰值 ${fmtHours(item.peak)}`),
                    ),
                  ),
                  h('button', { className: 'alims-link', onClick: () => onExplain(item.id) }, '解释'),
                ),
              ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '人员', meta: `${data.persons.length} 名` }),
            h(
              'div',
              { className: 'alims-person-list' },
              data.persons.map((person) =>
                h(
                  'div',
                  { key: person.id, className: 'alims-person' },
                  h(
                    'div',
                    { className: 'alims-person-head' },
                    h('div', null, h('strong', null, person.name), h('span', { className: 'alims-person-id' }, person.id)),
                    h(Pill, { tone: 'idle' }, person.employmentType),
                    h(Pill, { tone: person.utilization > 80 ? 'warn' : 'brand' }, `${person.utilization}% 负荷`),
                  ),
                  h('div', { className: 'alims-person-meta' }, `${person.team} · ${person.workHours} · 日容量 ${person.capacity}h`),
                  h('div', { className: 'alims-chip-row' }, (person.qualifications || []).map((qualification) => h(Pill, { key: qualification, tone: 'brand' }, qualification))),
                  (person.activities || []).length > 0
                    ? h(
                        'div',
                        { className: 'alims-activity-list' },
                        person.activities.map((activity) =>
                          h('div', { key: activity.id, className: 'alims-activity' }, h(Pill, { tone: activity.impact === 'Full-day block' ? 'error' : 'warn' }, activity.type), h('span', null, `${activity.title} · ${fmtDate(activity.start)}`)),
                        ),
                      )
                    : null,
                  h('div', { className: 'alims-person-bar' }, h(Bar, { value: person.utilization, tone: person.utilization > 80 ? 'warn' : 'brand', height: 5 })),
                ),
              ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '空间', meta: `${data.spaces.length} 个` }),
            h(
              'div',
              { className: 'alims-space-list' },
              data.spaces.map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'alims-space' },
                  h('div', null, h('strong', null, item.name), h('div', { className: 'alims-resource-meta' }, `${item.id} · ${item.location} · ${item.status}`)),
                  h('div', { className: 'alims-space-bar' }, h(Bar, { value: item.utilization, tone: 'brand', height: 5 })),
                  h('span', { className: 'alims-space-pct' }, `${item.utilization}%`),
                  h('button', { className: 'alims-link', onClick: () => onExplain(item.id) }, '解释'),
                ),
              ),
            ),
          ),
        );
      }

      // ---------------------------------------------------------------- analytics
      function AnalyticsPage({ onSimulate, simulate, simulateBusy, onReferenceEquipment }) {
        const state = useApi('/api/lims/analytics');
        const [type, setType] = useState('HPLC');
        const [count, setCount] = useState(1);
        if (state.loading && !state.data) return h('div', { className: 'alims-page' }, h(Loading, null));
        if (state.error) return h('div', { className: 'alims-page' }, h(ErrorBox, { message: state.error, onRetry: state.reload }));
        const data = state.data;
        if (!data) return null;
        const maxBucket = Math.max(1, ...(data.dueBuckets || []).map((bucket) => bucket.count));
        const types = unique((data.equipment || []).map((item) => item.type));
        return h(
          'div',
          { className: 'alims-page' },
          h(
            'div',
            { className: 'alims-stats' },
            h(StatTile, { label: '综合利用率', value: data.summary.equipmentUtilization, unit: '%', foot: `${data.summary.totalEquipmentHours}h / ${data.summary.totalCapacityHours}h`, tone: 'brand', icon: 'chart' }),
            h(StatTile, { label: '风险任务', value: data.summary.tasksAtRisk, unit: '项', foot: '按交期与负荷识别', tone: 'warn', icon: 'alert' }),
            h(StatTile, { label: '不可用设备', value: data.summary.blockedEquipment, unit: '台', foot: '校准 / 维护中', tone: 'error', icon: 'cube' }),
            h(StatTile, { label: '分析窗口', value: data.windowDays, unit: '天', foot: '未来资源窗口', tone: 'brand', icon: 'calendar' }),
          ),
          data.bottleneck
            ? h(
                Card,
                { className: 'alims-bottleneck' },
                h('div', { className: 'alims-bottleneck-icon' }, h(Icon, { name: 'target', size: 16 })),
                h('div', { className: 'alims-bottleneck-body' }, h('div', { className: 'alims-bottleneck-title' }, '主要瓶颈'), h('div', { className: 'alims-bottleneck-text' }, data.bottleneck.text)),
                h('div', { className: 'alims-bottleneck-value' }, data.bottleneck.utilization, h('span', null, '%')),
              )
            : null,
          h(
            Card,
            null,
            h(SectionTitle, { title: '设备负荷', meta: '按已排负荷占比' }),
            h(
              'div',
              { className: 'alims-load-list' },
              (data.equipment || []).map((item) =>
                h(
                  'div',
                  { key: item.id, className: 'alims-load-row' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'alims-load-name alims-load-name-btn',
                      title: `把“关于 ${item.name} 设备”加入聊天输入框`,
                      onClick: () => onReferenceEquipment?.(item),
                    },
                    h('span', null, item.name),
                    h('span', { className: 'alims-load-id' }, `${item.type} · 点击引用到聊天`),
                  ),
                  h('div', { className: 'alims-load-bar' }, h(Bar, { value: item.loadShare, tone: item.status === 'Operational' ? 'brand' : 'error', height: 7 })),
                  h('span', { className: 'alims-load-value' }, `${item.loadShare}%`),
                  h('span', { className: 'alims-load-hours' }, fmtHours(item.used)),
                ),
              ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '交期风险分布', meta: '按到期剩余天数' }),
            h(
              'div',
              { className: 'alims-bucket-list' },
              (data.dueBuckets || []).map((bucket) =>
                h(
                  'div',
                  { key: bucket.key, className: 'alims-bucket' },
                  h('span', { className: 'alims-bucket-label' }, bucket.label),
                  h('div', { className: 'alims-bucket-bar' }, h('div', { className: 'alims-bucket-fill', style: { width: `${(bucket.count / maxBucket) * 100}%` } })),
                  h('span', { className: 'alims-bucket-count' }, bucket.count),
                  h('span', { className: 'alims-bucket-detail' }, `紧急 ${bucket.urgent} · 高 ${bucket.high} · 普通 ${bucket.normal}`),
                ),
              ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '团队负荷', meta: '14 天窗口' }),
            h(
              'div',
              { className: 'alims-load-list' },
              (data.teams || []).map((team) =>
                h(
                  'div',
                  { key: team.team, className: 'alims-load-row' },
                  h('div', { className: 'alims-load-name' }, h('span', null, team.team)),
                  h('div', { className: 'alims-load-bar' }, h(Bar, { value: team.utilization, tone: team.utilization > 75 ? 'warn' : 'brand', height: 7 })),
                  h('span', { className: 'alims-load-value' }, `${team.utilization}%`),
                  h('span', { className: 'alims-load-hours' }, fmtHours(team.load)),
                ),
              ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '风险任务排序', meta: '引擎可解释结果' }),
            h(
              'div',
              { className: 'alims-risk-table' },
              (data.riskTasks || []).length === 0
                ? h('div', { className: 'alims-muted' }, '当前窗口内没有明显高风险任务。')
                : data.riskTasks.map((task) =>
                    h(
                      'div',
                      { key: task.id, className: 'alims-risk-table-row' },
                      h(Pill, { tone: task.level === 'high' ? 'error' : 'warn' }, task.level === 'high' ? '高' : '中'),
                      h('div', { className: 'alims-risk-table-main' }, h('strong', null, task.name), h('span', null, `${task.id} · ${task.projectName} · ${fmtDate(task.dueDate)} 交期 · ${task.daysLeft} 天`)),
                      h('span', { className: 'alims-risk-table-reason' }, task.reason),
                    ),
                  ),
            ),
          ),
          h(
            Card,
            null,
            h(SectionTitle, { title: '情景模拟', meta: '示意性产能估算' }),
            h(
              'div',
              { className: 'alims-simulate' },
              h('select', { className: 'alims-select', value: type, onChange: (event) => setType(event.target.value) }, types.map((item) => h('option', { key: item, value: item }, item))),
              h('select', { className: 'alims-select alims-select-sm', value: count, onChange: (event) => setCount(Number(event.target.value)) }, [1, 2, 3].map((item) => h('option', { key: item, value: item }, `+${item} 台`))),
              h('button', { className: 'alims-btn alims-btn-primary', disabled: simulateBusy, onClick: () => onSimulate(type, count) }, simulateBusy ? '计算中…' : '运行模拟'),
            ),
            simulate
              ? h(
                  'div',
                  { className: 'alims-simulate-result' },
                  h('div', null, h('span', null, '新增产能'), h('strong', null, fmtHours(simulate.scenario.extraCapacity))),
                  h('div', null, h('span', null, '受影响任务'), h('strong', null, simulate.scenario.affectedTasks)),
                  h('div', null, h('span', null, '延期风险'), h('strong', null, `${simulate.scenario.delayRiskBefore} → ${simulate.scenario.delayRiskAfter}`)),
                  h('p', null, simulate.scenario.note),
                )
              : null,
          ),
        );
      }

      // ------------------------------------------------------------------- audit
      function AuditPage() {
        const state = useApi('/api/lims/audit');
        if (state.loading && !state.data) return h('div', { className: 'alims-page' }, h(Loading, null));
        if (state.error) return h('div', { className: 'alims-page' }, h(ErrorBox, { message: state.error, onRetry: state.reload }));
        const events = state.data?.events || [];
        return h(
          'div',
          { className: 'alims-page' },
          h(
            Card,
            null,
            h(SectionTitle, { title: '审计事件', meta: `${events.length} 条` }),
            h(
              'div',
              { className: 'alims-audit' },
              events.map((event) =>
                h(
                  'div',
                  { key: event.id, className: 'alims-audit-row' },
                  h('span', { className: cx('alims-audit-dot', `is-${event.type}`) }),
                  h(
                    'div',
                    { className: 'alims-audit-main' },
                    h('div', { className: 'alims-audit-summary' }, event.summary),
                    event.detail ? h('div', { className: 'alims-audit-detail' }, event.detail) : null,
                    h('div', { className: 'alims-audit-meta' }, `${event.actor} · ${fmtDateTime(event.at)}${event.planId ? ` · ${event.planId}` : ''}${event.taskId ? ` · ${event.taskId}` : ''}`),
                  ),
                  h(Pill, { tone: event.type === 'plan_confirmed' ? 'ok' : event.type === 'plans_blocked' ? 'error' : 'idle' }, event.type),
                ),
              ),
            ),
          ),
          h('div', { className: 'alims-disclaimer' }, '原型审计记录保存在 MongoDB；正式系统需接入权限、审批、版本快照与保留策略。'),
        );
      }

      // -------------------------------------------------------------------- hook
      function useApi(path, deps = []) {
        const [state, setState] = useState({ data: null, loading: true, error: null });
        const [nonce, setNonce] = useState(0);
        useEffect(() => {
          if (!path) {
            setState({ data: null, loading: false, error: null });
            return undefined;
          }
          let alive = true;
          setState((previous) => ({ ...previous, loading: true }));
          api(path)
            .then((data) => alive && setState({ data, loading: false, error: null }))
            .catch((error) => alive && setState((previous) => ({ ...previous, loading: false, error: error.message })));
          return () => {
            alive = false;
          };
        }, [path, nonce, ...deps]);
        return { ...state, reload: () => setNonce((value) => value + 1) };
      }

      // ------------------------------------------------------------------- panel
      function LimsPanel({ inputActions }) {
        const [page, setPage] = useState('dashboard');
        const [role, setRole] = useState(() => {
          try {
            return (typeof localStorage !== 'undefined' && localStorage.getItem('alims.role')) || 'lead';
          } catch {
            return 'lead';
          }
        });
        const [overview, setOverview] = useState(null);
        const [overviewError, setOverviewError] = useState(null);
        const [overviewLoading, setOverviewLoading] = useState(true);
        const [taskId, setTaskId] = useState(null);
        const [detailKey, setDetailKey] = useState(0);
        const [plans, setPlans] = useState([]);
        const [selectedPlanId, setSelectedPlanId] = useState(null);
        const [comparison, setComparison] = useState(null);
        const [workspace, setWorkspace] = useState(null);
        const [impactTarget, setImpactTarget] = useState(null);
        const [projectTarget, setProjectTarget] = useState(null);
        const [explainId, setExplainId] = useState(null);
        const [simulate, setSimulate] = useState(null);
        const [simulateBusy, setSimulateBusy] = useState(false);
        const [busy, setBusy] = useState(false);
        const [toast, setToast] = useState(null);
        const [connected, setConnected] = useState(false);
        const workspaceRef = useRef(null);

        const showToast = useCallback((title, tone = 'info', detail = '') => {
          setToast({ title, tone, detail });
        }, []);
        const referenceEquipment = useCallback((item) => {
          if (!item || !inputActions) return;
          const phrase = `关于 ${item.name}（${item.id}）设备：`;
          try {
            if (typeof inputActions.captureInsertion === 'function' && typeof inputActions.insertText === 'function') {
              const span = inputActions.captureInsertion();
              const inserted = inputActions.insertText(phrase, span);
              if (!inserted) inputActions.setDraft(phrase);
            } else {
              inputActions.setDraft(phrase);
            }
            showToast('已引用到聊天输入框', 'ok', phrase);
          } catch {
            try {
              inputActions.setDraft(phrase);
              showToast('已引用到聊天输入框', 'ok', phrase);
            } catch {
              showToast('无法写入聊天输入框', 'error', '请先打开聊天输入框。');
            }
          }
        }, [inputActions, showToast]);
        const roleConfig = ROLES[role] || ROLES.lead;
        const menuItems = MENU.filter((item) => roleConfig.pages.includes(item.id));
        const changeRole = useCallback((next) => {
          if (!ROLES[next]) return;
          setRole(next);
          try {
            if (typeof localStorage !== 'undefined') localStorage.setItem('alims.role', next);
          } catch {
            /* storage can be unavailable */
          }
          setPage((current) => (ROLES[next].pages.includes(current) ? current : ROLES[next].defaultPage));
        }, []);

        const loadOverview = useCallback(async () => {
          try {
            const data = await api('/api/lims/overview');
            setOverview(data);
            setOverviewError(null);
            setConnected(true);
          } catch (error) {
            setOverviewError(error.message);
            setConnected(false);
          } finally {
            setOverviewLoading(false);
          }
        }, []);

        useEffect(() => {
          loadOverview();
          const timer = setInterval(loadOverview, 20000);
          return () => clearInterval(timer);
        }, [loadOverview]);

        useEffect(() => {
          let stopped = false;
          const tick = async () => {
            try {
              const next = await api('/api/lims/workspace');
              if (stopped) return;
              const previous = workspaceRef.current;
              workspaceRef.current = next;
              setWorkspace(next);
              setConnected(true);
              if (!previous || next.revision !== previous.revision) {
                if (next.page) setPage(next.page);
                if (next.taskId) {
                  setTaskId(next.taskId);
                  setDetailKey((value) => value + 1);
                }
                if (next.plans && next.plans.length > 0) {
                  setPlans(next.plans);
                  setSelectedPlanId(next.selectedPlanId || next.plans[0].id);
                } else if (next.page === 'schedule' && previous) {
                  setPlans([]);
                  setSelectedPlanId(null);
                }
                if (next.page === 'schedule') setComparison(next.comparison || null);
                if (next.resourceId) setExplainId(next.resourceId);
                if (next.page === 'impact') setImpactTarget({ equipmentId: next.equipmentId, date: next.date });
                if (next.page === 'projects') setProjectTarget({ projectId: next.projectId, testPlanId: next.testPlanId });
                if (previous && next.message) showToast(next.message, 'info');
              }
            } catch (error) {
              if (!stopped) setConnected(false);
            }
          };
          tick();
          const timer = setInterval(tick, 2600);
          return () => {
            stopped = true;
            clearInterval(timer);
          };
        }, [showToast]);

        const generatePlans = useCallback(
          async (id) => {
            setBusy(true);
            setTaskId(id);
            try {
              const data = await api('/api/lims/plans', { method: 'POST', body: { taskId: id } });
              setPlans(data.plans || []);
              setSelectedPlanId(data.plans?.[0]?.id || null);
              setComparison(null);
              setPage('schedule');
              if (data.plans?.length) {
                showToast(`已生成 ${data.plans.length} 个候选方案`, 'ok', data.plans.map((plan) => `${plan.id} ${plan.strategyLabel} · ${plan.score} 分`).join('\n'));
              } else {
                showToast('没有可行方案', 'error', (data.diagnostics || []).map((item) => item.text).join('\n'));
              }
              loadOverview();
            } catch (error) {
              showToast('生成方案失败', 'error', error.message);
            } finally {
              setBusy(false);
            }
          },
          [loadOverview, showToast],
        );

        const revisePlans = useCallback(
          async (id, options, previousPlanId) => {
            setBusy(true);
            setTaskId(id);
            try {
              const data = await api('/api/lims/plans', {
                method: 'POST',
                body: { taskId: id, previousPlanId, ...options },
              });
              setPlans(data.plans || []);
              setSelectedPlanId(data.plans?.[0]?.id || null);
              setComparison(data.comparison || null);
              setPage('schedule');
              if (data.comparison) {
                const delta = data.comparison.completionDeltaHours;
                showToast(
                  delta === null ? '已按新约束重排' : delta > 0 ? `重排完成：完成时间 +${delta}h` : delta < 0 ? `重排完成：完成时间 ${delta}h` : '重排完成：完成时间不变',
                  'ok',
                  (data.comparison.resourceChanges || []).map((change) => `${change.label}：${change.from || '—'} → ${change.to || '—'}`).join('\n'),
                );
              } else {
                showToast('已按新约束重排', 'ok', `生成 ${data.plans?.length || 0} 个候选方案`);
              }
              loadOverview();
            } catch (error) {
              showToast('重排失败', 'error', error.message);
            } finally {
              setBusy(false);
            }
          },
          [loadOverview, showToast],
        );

        const confirmPlan = useCallback(
          async (planId) => {
            setBusy(true);
            try {
              await api('/api/lims/confirm', { method: 'POST', body: { planId } });
              setPlans((previous) => previous.map((plan) => (plan.id === planId ? { ...plan, status: 'confirmed', statusLabel: '已模拟确认' } : plan)));
              showToast('已模拟确认排程', 'ok', '资源占用与审计已写入 MongoDB；未写入生产系统。');
              loadOverview();
            } catch (error) {
              showToast('确认被拒绝', 'error', error.message + (error.data?.conflicts ? `\n${error.data.conflicts.join('\n')}` : ''));
            } finally {
              setBusy(false);
            }
          },
          [loadOverview, showToast],
        );

        const openTask = useCallback((id) => {
          setTaskId(id);
          setDetailKey((value) => value + 1);
          setPage('task');
        }, []);

        const explainResource = useCallback((id) => {
          setExplainId(id || null);
          if (id) setPage('resources');
        }, []);

        const runSimulate = useCallback(
          async (equipmentType, count) => {
            setSimulateBusy(true);
            try {
              const data = await api('/api/lims/simulate', { method: 'POST', body: { equipmentType, addCount: count } });
              setSimulate(data);
              showToast('情景模拟完成', 'ok', data.scenario.note);
            } catch (error) {
              showToast('模拟失败', 'error', error.message);
            } finally {
              setSimulateBusy(false);
            }
          },
          [showToast],
        );

        const selectTask = useCallback((id) => {
          setTaskId(id);
          setPlans([]);
          setSelectedPlanId(null);
          setComparison(null);
        }, []);

        return h(
          'div',
          { className: 'alims-root' },
          h(TopBar, { page, setPage, connected, workspace, role, onRoleChange: changeRole, menuItems }),
          h(
            'div',
            { className: 'alims-body' },
            page === 'dashboard'
              ? h(Dashboard, { overview, loading: overviewLoading, error: overviewError, reload: loadOverview, onNavigate: setPage, onOpenTask: openTask, onGenerate: generatePlans, onExplain: explainResource, role, roleConfig })
              : null,
            page === 'projects'
              ? h(ProjectsPage, {
                  initialProjectId: projectTarget?.projectId,
                  initialTestPlanId: projectTarget?.testPlanId,
                  onOpenTask: openTask,
                  showToast,
                })
              : null,
            page === 'tasks'
              ? overview
                ? h(TaskList, { tasks: overview.tasks || [], onOpenTask: openTask })
                : overviewError
                  ? h(ErrorBox, { message: overviewError, onRetry: loadOverview })
                  : h(Loading, null)
              : null,
            page === 'task' && taskId
              ? h(TaskDetail, { taskId, onBack: () => setPage('tasks'), onGenerate: generatePlans, onExplain: explainResource, refreshKey: detailKey })
              : null,
            page === 'schedule'
              ? h(SchedulePage, {
                  tasks: overview?.tasks || [],
                  equipment: overview?.equipment || [],
                  taskId,
                  plans,
                  selectedPlanId,
                  comparison,
                  onSelectTask: selectTask,
                  onGenerate: generatePlans,
                  onRevise: revisePlans,
                  onSelectPlan: setSelectedPlanId,
                  onClearComparison: () => setComparison(null),
                  onConfirm: confirmPlan,
                  busy,
                  toast,
                })
              : null,
            page === 'impact'
              ? h(ImpactPage, {
                  initialEquipmentId: impactTarget?.equipmentId,
                  initialDate: impactTarget?.date,
                  onOpenTask: openTask,
                  onGenerate: generatePlans,
                  showToast,
                })
              : null,
            page === 'resources' ? h(ResourcePage, { explainId, onExplain: explainResource, refreshKey: overview?.stats?.totalLoadHours || 0 }) : null,
            page === 'analytics' ? h(AnalyticsPage, { onSimulate: runSimulate, simulate, simulateBusy, onReferenceEquipment: referenceEquipment }) : null,
            page === 'audit' ? h(AuditPage, null) : null,
          ),
          h(Toast, { toast, onClose: () => setToast(null) }),
        );
      }

      // ------------------------------------------------------------ header button
      function HeaderButton() {
        return h(
          'button',
          {
            type: 'button',
            title: '打开智能实验室（右侧边栏）',
            'aria-label': '打开智能实验室',
            className: 'alims-header-btn',
            style: {
              width: 26,
              height: 26,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #1e40af',
              borderRadius: 7,
              background: '#2563eb',
              color: '#ffffff',
              cursor: 'pointer',
              padding: 0,
            },
            onClick: () => {
              try {
                headerContext?.sidebarRight?.openTab(KIND);
              } catch {
                /* the tab type is registered while the plugin is active */
              }
            },
          },
          h(Icon, { name: 'flask', size: 14 }),
        );
      }

      let headerContext = null;

      return {
        inject: ['slots'],
        apply(ctx) {
          headerContext = ctx;
          ctx.effect(() => {
            if (typeof document === 'undefined') return () => {};
            const style = document.createElement('style');
            style.setAttribute('data-agentic-lims', 'styles');
            style.textContent = CSS;
            document.head.appendChild(style);
            return () => {
              style.remove();
            };
          }, 'agentic-lims: global styles');
          ctx.inject(['sidebarRightTabs'], (sub) => {
            sub.effect(
              () =>
                sub.sidebarRightTabs.register({
                  id: PKG,
                  kind: KIND,
                  title: () => '智能实验室',
                  guide: [
                    {
                      id: 'agentic-lims-guide',
                      order: 20,
                      title: () => '智能实验室',
                      description: () => 'Agentic LIMS 排程、资源与分析工作台',
                    },
                  ],
                }),
              'agentic-lims: right-sidebar tab type',
            );
          });
          ctx.inject(['sidebarRight'], (sub) => {
            sub.effect(() => {
              let timer = null;
              const opened = new Set();
              const tryOpen = () => {
                try {
                  const sessionId = sub.sidebarRight.mounted.getSnapshot();
                  if (!sessionId || opened.has(sessionId)) return;
                  sub.sidebarRight.openTab(KIND);
                  opened.add(sessionId);
                } catch {
                  /* layout store not ready; retry on the next tick */
                }
              };
              const unsubscribe = sub.sidebarRight.mounted.subscribe(tryOpen);
              timer = setInterval(tryOpen, 1400);
              const kick = setTimeout(tryOpen, 500);
              tryOpen();
              return () => {
                clearInterval(timer);
                clearTimeout(kick);
                unsubscribe();
              };
            }, 'agentic-lims: auto-open right-sidebar tab');
          });

          ctx.effect(
            () =>
              ctx.slots.inject('sidebar.right.pane.tab', () =>
                ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PKG }, LimsPanel),
              ),
            'agentic-lims: right-sidebar page body',
          );

          ctx.effect(
            () =>
              ctx.slots.inject('conversation.session.header.actions', () =>
                ctx.slots.register({ name: 'conversation.session.header.actions', id: 'agentic-lims-header', order: 15, label: '智能实验室' }, HeaderButton),
              ),
            'agentic-lims: header entry',
          );

          ctx.inject(['uiConversation'], (sub) => {
            /* The registry owns the registration effect; the returned disposer is idempotent. */
            sub.uiConversation.events.register(limsTurnDefinition);
          });

          ctx.effect(
            () =>
              ctx.slots.inject('conversation.chat.turnTail', () =>
                ctx.slots.register({ name: 'conversation.chat.turnTail', id: `${PKG}-answer-cards` }, LimsAnswerCards),
              ),
            'agentic-lims: answer cards',
          );

          const toolKeys = LIMS_TOOL_NAMES;
          for (const key of toolKeys) {
            ctx.effect(
              () =>
                ctx.slots.inject('tool.call.toolview', () =>
                  ctx.slots.register({ name: 'tool.call.toolview', key }, LimsToolView),
                ),
              `agentic-lims: chat card ${key}`,
            );
          }
        },
      };
    },
  });


})();
