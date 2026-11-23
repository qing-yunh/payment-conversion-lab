                                                                                                                  
                         
import { CHECK, addDays, buildCube, checkChange, compare, dataRange, defaultWindows, diagnose, optionsFor, segFilter } from '../engine/analytics.mjs';
import { LIMITS, toCsv } from '../engine/csv.mjs';
import { ANALYSIS_RULES_VERSION, analyse, conclusion } from '../engine/results.mjs';
import { generateSample } from '../engine/sample-data.mjs';
import { simulateResults } from '../engine/simulate.mjs';
import { buildDatabase, experimentState } from '../store/db.mjs';
import { refreshViews as refreshViewsIn, schemaGaps as schemaGapsIn, upgrade } from '../store/migrations.mjs';
import { createExperiment, createOpportunity, decisions, evidenceStatusOf, opportunityFor, recordCheck, evidenceRecord, experiments, freeze, importPrepared, nextImportIds, opportunities, plans, recordDecision, recordReview, resultRowsAfter, setTolerances, useEvidenceChecker } from '../store/store.mjs';
import { ask } from './background.mjs';
import { dayLabel, esc, icon, num } from './format.mjs';
import { checkDefaults, checkPage, checkParams } from './pages/check.mjs';
import { dataPage, helpPage } from './pages/data.mjs';
import { decisionSnapshotPage, decisionsPage } from './pages/decisions.mjs';
import { decisionDraft, experimentPage, experimentsPage, planNumbers } from './pages/experiment.mjs';
import { findingDetail, findings } from './pages/findings.mjs';
import { monitor } from './pages/monitor.mjs';
import { opportunitiesPage, opportunityDetail } from './pages/opportunities.mjs';
import { overview } from './pages/overview.mjs';
import { TOUR, tourBar, tourEvidence, tourPage, tourScenarios } from './pages/tour.mjs';
import { buildTourCase } from './tour-case.mjs';

export const VENDOR = 'vendor/sql.js-1.15.2/';
export const $app = document.getElementById('app');
                                                                                                             
export const IDB = { name: 'pcl-prototype-v2', store: 'db', key: 'main' };
export function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    let open;
    try { open = indexedDB.open(IDB.name, 1); } catch (e) { reject(e); return; }
    open.onupgradeneeded = () => open.result.createObjectStore(IDB.store);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => { let tx, req;
      try { tx = open.result.transaction(IDB.store, mode); req = fn(tx.objectStore(IDB.store)); } catch (e) { open.result.close(); reject(e); return; }                                                          
      tx.oncomplete = () => { open.result.close(); resolve(req.result); }; tx.onerror = tx.onabort = () => { open.result.close(); reject(tx.error); }; };
  });
}
export const SNAPSHOT = 'proto-v2-1';
                                                                                                                           
                                                                   
export let saveTimer = null, saveTarget = null, saving = Promise.resolve(), storageOk = true;
export function save() {
  if (tour) return;                                                       
  saveTarget = db; clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 150);
}
export function flushSave() {
  clearTimeout(saveTimer); saveTimer = null;
  const target = saveTarget; saveTarget = null;
  if (!target) return saving;
  let bytes;
                                                                                                      
  try { bytes = target.export(); } catch (error) { console.error('Saving to browser storage failed', error); storageOk = false; ui.unsaved = true; render(); saving = saving.then(() => false); return saving; }
                                                                                    
  saving = saving.then(() => idb('readwrite', st => st.put({ schema: SNAPSHOT, savedAt: new Date().toISOString(), bytes }, IDB.key)))
    .then(() => { const was = ui.unsaved; storageOk = true; ui.unsaved = false; if (was) render(); return true; },
      error => { console.error('Saving to browser storage failed', error); storageOk = false; ui.unsaved = true; render(); return false; });
  return saving;
}
                                                                                                                     
export const NOT_SAVED = 'Not saved in this browser: the change is only in this tab. Use Retry saving at the top of the page.';
export async function persist(msg) {
  if (tour) { render(); if (msg) toast(msg); return true; }
  saveTarget = db; const ok = await flushSave();
  render(); if (msg || !ok) toast(ok ? msg : NOT_SAVED);
  return ok;
}
export function cancelSave() { clearTimeout(saveTimer); saveTimer = null; saveTarget = null; }

                  
export let SQL, db = null, schemaSql, extSql, legacy = null;
export const ui = { integrity: {}, analysis: {}, busy: null, decisionDraft: {}, decisionInput: {}, riskChecks: {}, monitor: null, diagWin: null, diag: null, assumptions: {}, importDraft: null, sim: { effect: 3 }, toast: null, animateSeal: null, planDraft: {} };
export function resetUi() {
  const r = dataRange(db), w = defaultWindows(db);
  ui.monitor = { from: w.cur[0], to: r.last, compare: 'previous', filters: {}, metric: 'submission', split: 'channel', smooth: true, dim: 'channel', sort: 'delta' };
  ui.diagWin = w; ui.diag = null; ui.importDraft = null; ui.planDraft = {}; ui.integrity = {}; ui.analysis = {};
  clearCaseInput();
}
                                                                                                                                  
                                                                                                        
export const CASE_INPUT = ['decisionDraft', 'decisionInput', 'riskChecks', 'typing', 'forceImport', 'check'];
export function clearCaseInput() { Object.assign(ui, { decisionDraft: {}, decisionInput: {}, riskChecks: {}, typing: null, forceImport: null, check: null }); }
                                                                                                                         
                                                                                                                     
                                                    
export function integrityOf(evidenceId) { if (!evidenceId) return null; loadEvidence(evidenceId); return ui.integrity[evidenceId]; }
export function analysisOf(evidenceId) { if (!evidenceId) return null; loadEvidence(evidenceId); return ui.analysis[evidenceId] ?? null; }
function loadEvidence(id) {
  if (ui.integrity[id] !== undefined) return;
  ui.integrity[id] = 'checking'; const on = db;
                                                                                                                               
  (async () => {
    try {
      const r = await checkStored(on, id), status = await evidenceStatusOf(live(on), id, r.check);
      if (db === on) { ui.integrity[id] = status; ui.analysis[id] = r.analysis; render(); }
    } catch (error) {
      if (error instanceof Closed) return;                                                                                           
      console.error('Checking the evidence failed', error); if (db === on) { ui.integrity[id] = { ok: false, status: 'unverifiable', failed: error.message }; render(); }
    }
  })();
}
                                                                                                                               
                                                                                                           
const closedDbs = new WeakSet();
class Closed extends Error {}
const live = on => { if (closedDbs.has(on)) throw new Closed('The database was closed while its evidence was being checked.'); return on; };
function closeDb(d) { if (!d) return; closedDbs.add(d); d.close(); }
let checkSeq = 0;
async function checkStored(on, id) {
  const rec = evidenceRecord(on, id), x = experiments(on).find(e => e.experiment_id === rec.experimentId), key = `check-${id}-${++checkSeq}`;
  let after = '', read = 0;
  try {
    for (;;) {
      const batch = resultRowsAfter(live(on), rec.imported.ds, after, 5000);
      if (!batch.length) break;
      read += batch.length; after = batch.at(-1).record_id;
      await ask('feed', { key, rows: batch });
      paintChecking(`Reading the stored rows: ${num(read)} of ${num(rec.imported.row_count)}`);
    }
  } catch (error) { if (error instanceof Closed) await ask('forget', { key }).catch(() => {}); throw error; }                                         
  paintChecking('Analysing the results');
  return ask('check', { key, options: { evidence: rec.evidence, imported: rec.imported, guardrails: x.guardrails } });
}
const paintChecking = text => document.querySelectorAll('[data-checking] [data-progress]').forEach(el => { el.textContent = text; });
useEvidenceChecker(async (d, id) => (d === db && ui.analysis[id] && ui.integrity[id]?.check ? { check: ui.integrity[id].check, analysis: ui.analysis[id] } : checkStored(d, id)));
export const checkingPanel = () => '<div class="panel empty" data-checking><h2>Checking the evidence…</h2><p>Reading the stored results in small steps and checking they still match the imported file.</p><p class="small muted" data-progress></p></div>';
                                                                                                                           
export const decidedVoid = x => x.state.stage === 'Decided' && isVoid(x.state.evidence_id);
export const isVoid = id => { const v = integrityOf(id); return !!v && v !== 'checking' && !v.ok; };
                                                                                                             
export const evidenceState = id => ui.integrity[id]?.status;
export const historicalPanel = x => `<div class="callout warn"><b>Historical evidence, not current</b>${esc(x.state.evidence_id)} was checked against its import under the analysis rules it was imported with (${esc(ui.integrity[x.state.evidence_id]?.rulesVersion ?? 'unknown')})${ui.integrity[x.state.evidence_id]?.planSchema === 'pcl-checkout-plan-v1' ? ', with a plan frozen before plans recorded what they test' : ''}. It is kept as history: it cannot carry a new review or decision. To analyse again, freeze a new plan and import the results.</div>`;
export const voidPanel = x => (evidenceState(x.state.evidence_id) === 'historical' ? historicalPanel(x) : `<div class="callout fail"><b>This analysis is void</b>${ui.integrity[x.state.evidence_id]?.failed ? `The check of the stored rows could not finish (${esc(ui.integrity[x.state.evidence_id].failed)}), so they are treated as not matching.` : `The stored result rows no longer match the imported file, or the analysis rules changed since import (${esc(ui.integrity[x.state.evidence_id]?.rulesVersion)}).`} Reviews and decisions are locked until the results are imported again.</div>
  <a class="btn" style="margin-top:12px" data-act="reimport" data-id="${x.experiment_id}" href="#">Import again</a>`);
export const friendly = error => (error.message.includes('PLANNING_READY_GATE_NOT_MET') ? 'Planning Ready needs checked evidence and both reviews passed.'
  : error.message.includes('EVIDENCE_VOID') ? 'The evidence no longer matches its import. Import the results again.'
  : error.message.includes('EVIDENCE_HISTORICAL') ? 'This is historical evidence: it is kept, but it cannot carry a new review or decision. Freeze a new plan and import the results.'
  : error.message.includes('EVIDENCE_REQUIRED') ? 'There are no results to decide on yet. Import the results first.'
  : error.message.includes('EVIDENCE_UNVERIFIABLE') ? 'The evidence could not be checked, so it cannot carry a review or decision. Try again, or import the results again.'
  : error.message.includes('PLAN_V1_REFREEZE_REQUIRED') ? 'This plan was frozen before plans recorded what they test. Freeze a new plan, then import the results.'
  : error.message.includes('OVERRIDE_REASON_REQUIRED') ? 'The results do not show that B improves the metric. To choose Planning Ready anyway, write why in the box under the verdict.'
  : error.lost ? `${error.message} Nothing was stored. Choose the file again.` : error.message);
                                                                                                                               
const dropLostDraft = error => { if (error.lost) { ui.importDraft = null; ui.forceImport = null; render(); } };
export const getDiag = () => (ui.diag ??= diagnose(db, ui.diagWin));
                                                                                                                         
                                                                                                                         
export function paintToast() {
  let region = document.getElementById('toast-region');
  if (!region) { document.body.insertAdjacentHTML('beforeend', '<div id="toast-region" role="status" aria-live="polite"></div>'); region = document.getElementById('toast-region'); }
  region.innerHTML = ui.toast ? `<div class="toast">${esc(ui.toast)}</div>` : '';
}
                                                                                                                           
                                                                                                                  
                                                                                                                
let busyTimer = null;
export function setBusy(title, stage) {
  if (!ui.busy || ui.busy.stage !== stage) ui.busy = { title, stage, since: performance.now(), hash: ui.busy?.hash ?? location.hash };
  paintBusy();
  busyTimer ??= setInterval(paintBusy, 250);
}
export function clearBusy() { ui.busy = null; clearInterval(busyTimer); busyTimer = null; paintBusy(); }
function paintBusy() {
  let el = $app.querySelector('.busy');
  if (!ui.busy) { el?.remove(); return; }
  if (!el) { $app.insertAdjacentHTML('beforeend', '<div class="busy" role="status" aria-live="polite"><div class="busy-box"><b></b><span data-progress></span></div></div>'); el = $app.querySelector('.busy'); }
  el.querySelector('b').textContent = ui.busy.title;
  el.querySelector('[data-progress]').textContent = `${ui.busy.stage} · ${((performance.now() - ui.busy.since) / 1000).toFixed(1)} s`;
}
export function toast(msg) { ui.toast = msg; paintToast(); setTimeout(() => { if (ui.toast === msg) { ui.toast = null; paintToast(); } }, 3200); }

export async function loadSample(options = {}) {
  closeDb(db);
  ({ db } = buildDatabase(SQL, schemaSql, generateSample(options), () => {}));
  db.exec(extSql); buildCube(db); resetUi(); save();
}

                  
export function shell(active, content) {
  const counts = db ? { findings: getDiag().findings.length, opportunities: opportunities(db).length, experiments: experiments(db).length, decisions: decisions(db).length } : {};
  const link = (key, label) => `<a href="#/${key}" ${active === key ? 'aria-current="page"' : ''}>${label}${counts[key] !== undefined ? `<span class="count">${counts[key]}</span>` : ''}</a>`;
  return `<div class="shell"><a class="skip-link" href="#main" data-act="skip">Skip to main content</a><nav class="rail" aria-label="Main">
    <a class="brand" href="#/">Payment Conversion Lab<span>UK checkout analysis</span></a>
    <div class="nav">${link('', 'Overview')}${link('monitor', 'Monitor')}${link('findings', 'Findings')}${link('opportunities', 'Opportunities')}${link('experiments', 'Experiments')}${link('decisions', 'Decisions')}</div>
    <div class="nav lower">${link('tour', '5-minute tour')}${link('data', 'Data')}${link('help', 'Help')}</div></nav>
    <main class="page" id="main" tabindex="-1">${tour ? tourBar() : ''}${tour ? '' : ui.unsaved ? '<div class="callout warn small" role="alert" style="margin-bottom:12px"><b>Not saved in this browser</b>Your latest changes are only in this tab and will be lost if you close or reload it. <button class="btn small" data-act="retry-save">Retry saving</button></div>' : storageOk ? '' : '<p class="callout warn small" style="margin-bottom:12px">Browser storage is unavailable, so changes will not be kept after you close this tab.</p>'}${content}</main></div>`;                                          
}
export function dataBadge() {
  if (!db) return '';
  const r = dataRange(db);
  if (tour) return `<span class="badge">Tour copy · synthetic · ${dayLabel(r.first)} – ${dayLabel(r.last)} 2026</span>`;
  return `<a class="badge" href="#/data">Sample data · synthetic · ${dayLabel(r.first)} – ${dayLabel(r.last)} 2026</a>`;
}
export const head = (title, extra = '') => `<div class="page-head"><h1>${title}</h1>${extra}${dataBadge()}</div>`;
export const needData = active => shell(active, `<div class="panel empty" style="margin-top:20px"><h2>No data loaded</h2><p>Load the sample dataset to explore the full analysis. Your own data import arrives in the next release.</p><button class="btn primary" data-act="load-sample">Load sample data</button></div>`);

export let tour = null, tourBuilding = null, tourError = null;
export async function buildTour() {
  await flushSave();                                                                         
  const saved = { db, ui: { monitor: ui.monitor, diagWin: ui.diagWin, diag: ui.diag, planDraft: ui.planDraft, importDraft: ui.importDraft, assumptions: ui.assumptions, integrity: ui.integrity, analysis: ui.analysis, ...Object.fromEntries(CASE_INPUT.map(k => [k, ui[k]])) } };
  db = buildDatabase(SQL, schemaSql, generateSample(), () => {}).db; db.exec(extSql); buildCube(db);
  ui.assumptions = {}; ui.integrity = {}; resetUi();
  try {
    const c = await buildTourCase(db);                                                               
    ui.diag = c.d;                                                                 
    tour = { step: 1, saved, ...c };
  } catch (error) { closeDb(db); db = saved.db; Object.assign(ui, saved.ui); throw error; }
}
export function exitTour() {
  if (!tour) return;
  closeDb(db); db = tour.saved.db; Object.assign(ui, tour.saved.ui); tour = null;
}
export function tourStep(n) {
  if (!(n >= 1 && n <= TOUR.length)) return notFound('tour');
  if (!tour) {
    if (tourError) { const msg = tourError; tourError = null; return shell('tour', `<div class="callout fail"><b>The tour could not start</b>${esc(msg)}</div>`); }
    tourBuilding ??= buildTour().then(() => { tourBuilding = null; render(); }, e => { console.error(e); tourBuilding = null; tourError = e.message; render(); });
    return shell('tour', `<div class="panel empty"><h2>Building the tour case…</h2><p>Generating 90 days of synthetic checkouts, finding the problem, sealing a plan and importing results. This takes a few seconds.</p></div>`);
  }
  tour.step = n; tour.focus = null;
                                                                                                                                        
  if (n === 1) Object.assign(ui.monitor, { from: tour.d.window.cur[0], to: tour.d.window.cur[1], compare: 'previous', split: tour.f.segment.dim, dim: tour.f.segment.dim, sort: 'delta', metric: tour.f.metric, smooth: true, filters: {} });
  return [() => monitor(), () => findings(), () => findingDetail(tour.f.id), () => opportunityDetail(tour.oppId), () => experimentPage(tour.expId, 'results'), tourScenarios, () => experimentPage(tour.expId, 'decision')][n - 1]();
}
                                                                                                                
export const refreshViews = candidate => refreshViewsIn(SQL, schemaSql, extSql, candidate);
export const schemaGaps = candidate => schemaGapsIn(SQL, schemaSql, extSql, candidate);
export function legacyPage() {
  const when = legacy.snap.savedAt ? new Date(legacy.snap.savedAt).toUTCString().slice(5, 22) + ' UTC' : 'an earlier date';
  const download = `<button class="btn" data-act="legacy-backup">${icon('download')} Download the saved workspace (.sqlite)</button>`;
  if (legacy.kind === 'upgrade-failed') return shell('', `<section class="panel pad stack legacy"><h1>Your saved workspace could not be upgraded</h1>
    <p>This browser holds a workspace saved on ${esc(when)}. This version upgrades it to a newer data structure before opening it, and the upgrade did not complete: ${esc(legacy.reason)}.</p>
    <p><b>Nothing was changed.</b> The saved workspace is exactly as it was, and it remains available to the earlier version.</p>
    <div class="row">${download}<button class="btn primary" data-act="retry-upgrade">Try the upgrade again</button></div></section>`);
  const g = legacy.gaps;
  return shell('', `<section class="panel pad stack legacy"><h1>Your saved workspace is from an earlier build</h1>
    <p>This browser holds a workspace saved on ${esc(when)} by an earlier version. Its data structure is one this version does not recognise (${esc(g.slice(0, 4).join(', '))}${g.length > 4 ? ` and ${g.length - 4} more` : ''}), so it does not open or change it. Nothing has been deleted.</p>
    <div class="row">${download}<button class="btn primary" data-act="legacy-new">Start a new workspace</button></div>
    <p class="small muted">Starting a new workspace keeps the old copy in this browser under a separate name; it is not overwritten. Workspaces with a structure this version recognises are upgraded automatically.</p></section>`);
}
export const notFound = active => shell(active, '<div class="panel empty"><h2>Page not found</h2><p>This link does not match anything in the workspace.</p><a class="btn" href="#/">Go to Overview</a></div>');

                   
                                                                                                                        
                                                                                                                                    
                                                                                          
let drawing = false, again = false;
                                                                                                        
let drawn = { hash: null, db: null }, keeping = null;
                                                                                                                                 
                                                                                           
let committed = null;
export function render() {
  if (drawing) { again = true; return; }
  const p = location.hash.replace(/^#\/?/, '').split('/');
  let html;
  try {
    html = legacy && !['tour', 'help'].includes(p[0]) ? legacyPage() : !p[0] ? overview() : p[0] === 'monitor' ? monitor() : p[0] === 'findings' ? (p[1] === 'check' ? checkPage() : p[1] ? findingDetail(p[1]) : findings()) : p[0] === 'opportunities' ? (p[1] ? opportunityDetail(p[1]) : opportunitiesPage())
      : p[0] === 'experiments' ? (p[1] ? experimentPage(p[1], p[2] || 'plan') : experimentsPage()) : p[0] === 'decisions' ? (p[1] ? decisionSnapshotPage(p[1]) : decisionsPage()) : p[0] === 'data' ? dataPage() : p[0] === 'help' ? helpPage() : p[0] === 'tour' ? (p[1] ? tourStep(Number(p[1])) : tourPage()) : notFound('');
  } catch (error) {
    console.error(error);
    html = shell('', `<div class="callout fail"><b>Something went wrong on this page</b>${esc(error.message)}</div>`);
  }
                                                                                                        
                                                                                                    
  const kept = ui.typing;
                                                                                                             
                                                                                                                                   
                                                                                                               
  const active = document.activeElement, liveKey = active && $app.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)
    && !['checkbox', 'radio', 'file', 'date'].includes(active.type) ? fieldKey(active) : null;
  const done = liveKey && committed?.el === active && committed.hash === location.hash && committed.db === db;
  const live = liveKey && !done && drawn.hash === location.hash && drawn.db === db ? active : null;
                                                                                                            
  const opened = ui.foldHash === location.hash ? new Set([...$app.querySelectorAll('details.m-fold[open] > summary')].map(s => s.textContent)) : null;
  ui.foldHash = location.hash;
  drawing = true; keeping = live;                                                             
  try { $app.innerHTML = html; } finally { drawing = false; keeping = null; }
  drawn = { hash: location.hash, db };
  if (again) { again = false; queueMicrotask(render); }
  if (opened) for (const s of $app.querySelectorAll('details.m-fold > summary')) if (opened.has(s.textContent)) s.parentElement.open = true;
  const fresh = live && $app.querySelector(liveKey);
  if (fresh && fresh.tagName === live.tagName && fresh.type === live.type) { fresh.replaceWith(live); live.focus({ preventScroll: true }); if (kept?.key === liveKey) ui.typing = kept; }
  else if (done) {                                                                                 
    committed = null;
    const again = $app.querySelector(liveKey);
    if (again) { again.focus({ preventScroll: true }); try { again.setSelectionRange(again.value.length, again.value.length); } catch {                                   } }
  }
  else {
    const typing = kept && $app.querySelector(kept.key);
    if (typing) { ui.typing = kept; typing.value = kept.value; if (kept.focused) { typing.focus(); try { typing.setSelectionRange(kept.start, kept.end); } catch {                                   } } }
  }
  paintToast();
  paintBusy();
  if (tour) for (const el of $app.querySelectorAll(TOUR_LOCKED_SEL)) { el.setAttribute('aria-disabled', 'true'); el.title = 'Read-only in the tour'; if ('disabled' in el) el.disabled = true; }
                                                                                                                                   
  const focus = tour?.focus && document.getElementById(tour.focus);
  if (focus) {
    if (focus.tagName === 'DETAILS') focus.open = true;
    focus.classList.add('tour-target'); focus.setAttribute('tabindex', '-1'); focus.focus({ preventScroll: true });                                      
    focus.scrollIntoView({ block: 'start' }); tour.focus = null; tour.focused = true;
  }
  ui.animateSeal = null;
}

                   
                                                                                    
                                                                                
export const TOUR_LOCKED = new Set(['open-opp', 'open-check-opp', 'new-exp', 'freeze', 'sim-use', 'import', 'design-review', 'evidence-review', 'reimport', 'reset-ask', 'reset', 'load-sample', 'retry-save']);
export const TOUR_LOCKED_SEL = [...TOUR_LOCKED].map(a => `[data-act="${a}"]`).concat(['form[data-form] button[type="submit"]', 'input[data-act="file"]']).join(',');
export const tourLockedToast = () => toast('The tour is read-only. Choose “Try it yourself” to do this in your own workspace.');
                                                                                                                        
async function parseInto(experimentId, { file, text, name, isSample = false }) {
  if (ui.importDraft?.job) ask('drop', { job: ui.importDraft.job }).catch(() => {});
  const job = `job-${++checkSeq}`, title = `Reading ${name}`;
  setBusy(title, 'Starting');
  try { ui.importDraft = draftOf(await ask('parse', { job, file, text, experimentId }, stage => setBusy(title, stage)), name, experimentId, currentPlan(experimentId), isSample, job); }
  catch (error) { console.error(error); ui.importDraft = { experimentId, name, fatal: `The file could not be read: ${error.message}` }; }
  finally { clearBusy(); render(); }
}
function draftOf(summary, name, experimentId, plan, isSample, job) {
  if (summary.fatal) return { experimentId, name, fatal: summary.fatal };
  const win = (plan?.observationWindowMinutes ?? 30) * 60_000;                                                                                 
  const horizon = plan ? Date.parse(plan.enrollmentEnd) + win + 1000 : 0, lastEvent = summary.validation.stats?.lastEvent;
  const last = lastEvent ? new Date(Math.max(Date.parse(lastEvent) + win, horizon)) : null;
  return { experimentId, name, job, ...summary, coverage: last ? last.toISOString().replace(/\.\d{3}Z$/, 'Z') : '', complete: isSample, sample: isSample };                                                 
}
export function currentPlan(id) { const s = experimentState(db, id); return plans(db, id).find(p => p.fingerprint === s.plan_fingerprint); }
export function sampleRows(id) { const x = experiments(db).find(e => e.experiment_id === id); return simulateResults(db, { plan: currentPlan(id), segment: x.segment, trueEffectPP: Number(ui.sim.effect) || 0 }); }

                                                                                                                          
                                                                                
let checkRunning = false;
async function runCheck(button) {
  if (checkRunning) return;
  checkRunning = true; button.disabled = true;
  try {
    const c = ui.check ??= checkDefaults(), v = k => document.querySelector(`[data-bind="check.${k}"]`)?.value ?? '';
    Object.assign(c, { metric: v('metric'), dim: v('dim'), value: v('dim') ? v('value') : '', date: v('date'), days: Number(v('days')) || CHECK.defaultDays });
    if (!c.date) { toast('Choose the change date.'); return; }
    if (c.dim && !c.value) { toast('Choose which segment to check.'); return; }
    const r = checkChange(db, checkParams(c)); c.ran = { metric: c.metric, dim: c.dim, value: c.value, date: c.date, days: c.days }; ui.typing = null;
                                                                                                    
    if (tour) render(); else { recordCheck(db, r); await persist(null); }
  } finally { checkRunning = false; if (button.isConnected) button.disabled = false; }
}
document.addEventListener('click', async ev => {
  if (ui.busy) { ev.preventDefault(); return; }                         
  const row = ev.target.closest('tr[data-href]');
  if (row && !ev.target.closest('a,button,input,select,details')) { location.hash = row.dataset.href; return; }
  const t = ev.target.closest('[data-act]');
  if (!t || t.tagName === 'INPUT') return;
  const act = t.dataset.act, id = t.dataset.id;
                                                                                                                 
  if (act === 'skip') { ev.preventDefault(); document.getElementById('main')?.focus(); return; }
  if (tour && TOUR_LOCKED.has(act)) { ev.preventDefault(); tourLockedToast(); return; }
  try {
    if (act === 'load-sample') { t.disabled = true; t.textContent = 'Building the dataset…'; await new Promise(r => setTimeout(r, 20)); await loadSample(); location.hash = '#/'; render(); toast('Sample data loaded: 90 days of synthetic checkouts.'); }
    else if (act === 'range') { const n = Number(t.dataset.days), last = dataRange(db).last; ui.monitor.to = last; ui.monitor.from = addDays(last, -(n - 1)) < dataRange(db).first ? dataRange(db).first : addDays(last, -(n - 1)); render(); }
    else if (act === 'clear-filters') { ui.monitor.filters = {}; render(); }
    else if (act === 'sort') { ui.monitor.sort = t.dataset.sort; render(); }
    else if (act === 'run-check') await runCheck(t);
    else if (act === 'open-check-opp') { const r = checkChange(db, checkParams(ui.check.ran));
      if (r.status !== 'worse') return;
      const had = opportunityFor(db, r), o = createOpportunity(db, { ...r, window: r.window }); location.hash = '#/opportunities/' + o;
      await persist(had ? `Already open as ${o}: the same problem.` : `Opened ${o} from the check.`); }
    else if (act === 'diag-default') { ui.diagWin = defaultWindows(db); ui.diag = null; render(); }
    else if (act === 'open-opp') { const f = getDiag().findings.find(x => x.id === id); const o = createOpportunity(db, { ...f, window: getDiag().window }); location.hash = '#/opportunities/' + o; await persist(`Opened ${o}.`); }
    else if (act === 'new-exp') { const o = opportunities(db).find(x => x.opportunity_id === t.dataset.opp); const rule = optionsFor(o.finding).find(r => r.id === t.dataset.rule);
      const e = createExperiment(db, o.opportunity_id, rule, o.finding.segment); location.hash = `#/experiments/${e}/plan`; await persist(`Created ${e}. Set the plan, then freeze it.`); }
    else if (act === 'freeze') { const x = experiments(db).find(e => e.experiment_id === id), d = ui.planDraft[id], n = planNumbers(x, d);
      if (n.err || n.short) return;
      if (!currentPlan(id)) setTolerances(db, id, d.tol);                                                 
      const plan = await freeze(db, id, { baselineRate: +n.base.toFixed(4), mdePP: Number(d.mde), enrollmentStart: d.start + 'T00:00:00Z', enrollmentEnd: n.end + 'T23:59:59Z' });
      ui.animateSeal = plan.fingerprint; await persist(`Plan v${plan.planVersion} frozen.`); }
    else if (act === 'sim-download') { const blob = new Blob([toCsv(sampleRows(id))], { type: 'text/csv' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${id}-sample-results-${ui.sim.effect}pp.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    else if (act === 'sim-use') await parseInto(id, { text: toCsv(sampleRows(id)), name: `${id}-sample-results-${ui.sim.effect}pp.csv`, isSample: true });
    else if (act === 'import') { const d = ui.importDraft;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(d.coverage)) { toast('Enter the coverage time as 2026-12-01T00:30:00Z.'); return; }
                                                                                                               
      const x = experiments(db).find(e => e.experiment_id === id), plan = currentPlan(id), ids = nextImportIds(db, id), title = `Importing ${num(d.rowCount)} rows`, job = d.job;
      setBusy(title, 'Starting');
      try {
        const prepared = await ask('prepare', { job, options: { plan, coverageThrough: d.coverage, coverageComplete: d.complete, ...ids, guardrails: x.guardrails } }, stage => setBusy(title, stage));
        async function* batches() { for (let from = 0; from < prepared.count; from += 5000) yield await ask('rows', { job, from, size: 5000 }); }
        const evd = await importPrepared(db, { experimentId: id, plan, fileName: d.name, coverageThrough: d.coverage, coverageComplete: d.complete, ...ids, prepared, batches: batches(), onProgress: stage => setBusy(title, stage) });
                                                                                                                    
        ui.integrity[evd.id] = await evidenceStatusOf(db, evd.id, { digestOk: true, rulesVersion: ANALYSIS_RULES_VERSION }); ui.analysis[evd.id] = prepared.analysis;
        ask('drop', { job }).catch(() => {}); ui.importDraft = null; ui.forceImport = null;
        setBusy(title, 'Saving in this browser');
        await persist(`${evd.id}: ${evd.evidenceStatus}.`);
      } catch (error) { dropLostDraft(error); throw error; } finally { clearBusy(); } }
    else if (act === 'design-review') { const outcome = t.dataset.outcome, checks = [...document.querySelectorAll('[data-check]')];
      if (outcome === 'Pass' && checks.some(c => !c.checked)) { toast('Tick every check to record a Pass.'); return; }
      await recordReview(db, { experimentId: id, type: 'treatment_design', outcome, level: 'Design Review Only', checks: checks.map(c => ({ id: c.dataset.check, ok: c.checked })) }); delete ui.riskChecks[id]; await persist(null); }
    else if (act === 'evidence-review') { const s = experimentState(db, id), a = analysisOf(s.evidence_id);
      if (!a) { toast('The evidence is still being checked. Try again in a moment.'); return; }
      await recordReview(db, { experimentId: id, type: 'evidence', evidenceId: s.evidence_id, outcome: t.dataset.outcome, level: 'Verified With Available Data', checks: a.guardrails }); await persist(null); }
    else if (act === 'reimport') { ev.preventDefault(); ui.forceImport = id; if (!location.hash.endsWith(`/${id}/results`)) location.hash = `#/experiments/${id}/results`; render(); }
    else if (act === 'tour-try') { exitTour(); location.hash = db ? '#/findings' : '#/'; render(); toast(db ? 'This is your workspace. Open a finding to start your own case.' : 'Your workspace is empty. Load the sample data to start your own case.'); }
    else if (act === 'legacy-backup') { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([legacy.snap.bytes], { type: 'application/vnd.sqlite3' }));
      a.download = `pcl-workspace-${(legacy.snap.savedAt ?? 'old').slice(0, 10)}.sqlite`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
    else if (act === 'retry-upgrade') location.reload();
    else if (act === 'legacy-new') { t.disabled = true; await idb('readwrite', st => st.put(legacy.snap, `legacy-${legacy.snap.savedAt ?? Date.now()}`)); legacy = null;
      await loadSample(); location.hash = '#/'; render(); toast('New workspace started. The old one is kept in this browser.'); }
    else if (act === 'tour-evidence' && tour) { const e = tourEvidence(tour.step); tour.evidenceStep = tour.step; tour.focus = e.focus ?? null;
      if (e.monitor) ui.monitor.filters = segFilter(tour.f.segment);                                                   
      if (location.hash === e.href) render(); else location.hash = e.href; }
    else if (act === 'tour-exit') { exitTour(); location.hash = '#/tour'; render(); toast('Tour closed. Your workspace is as you left it.'); }
    else if (act === 'retry-save') { t.disabled = true; saveTarget = db; const ok = await flushSave(); render(); toast(ok ? 'Saved in this browser.' : 'Still not saved. Keep this tab open and try again; check that the browser allows site storage.'); }
    else if (act === 'reset-ask') document.getElementById('reset').showModal();
    else if (act === 'reset-cancel') document.getElementById('reset').close();
    else if (act === 'reset') { cancelSave(); await saving; await idb('readwrite', s => s.delete(IDB.key)).catch(() => {}); closeDb(db); db = null; clearCaseInput(); location.hash = '#/'; render(); toast('All data deleted from this browser.'); }
  } catch (error) { console.error(error); toast(friendly(error)); }
});
                                                                                                                    
                                                                                                                                  
                                                                                                                        
const owed = new WeakSet();
const payOwed = t => { if (!owed.has(t) || t === keeping) return; owed.delete(t); t.dispatchEvent(new Event('change', { bubbles: true })); };
document.addEventListener('focusout', ev => payOwed(ev.target), true);                                                               
document.addEventListener('keydown', ev => { if (ev.key === 'Enter') payOwed(ev.target); }, true);                                                   
document.addEventListener('change', async ev => {
  const t = ev.target;
  if (ui.busy) return;
  if (t === keeping) { owed.add(t); return; }                                                                      
  owed.delete(t);                      
  committed = { el: t, hash: location.hash, db };                         
  if (ui.typing && t.matches?.(ui.typing.key)) ui.typing = null;                                                    
                                                                                                       
  if (t.name === 'v' && t.form?.dataset.form === 'decision') { const by = ui.decisionDraft[t.form.dataset.id]?.nextBy ?? {}, box = t.form.elements.next;
    if (box && Object.values(by).some(d => d.trim() === box.value.trim()) && by[t.value]) box.value = by[t.value]; keepDecision(t.form); return; }
  if (t.dataset.check) { const fs = t.closest('fieldset'); ui.riskChecks[fs.dataset.id] = [...fs.querySelectorAll('[data-check]:checked')].map(c => c.dataset.check); return; }
  if (t.dataset.bind) {
    const [scope, key] = t.dataset.bind.split('.');
    if (scope === 'monitor') { ui.monitor[key] = key === 'smooth' ? t.value === '1' : key === 'compare' ? t.value : t.value; if (key === 'from' && ui.monitor.from > ui.monitor.to) ui.monitor.to = ui.monitor.from; }
    if (scope === 'check') { const c = ui.check ??= checkDefaults(); c[key] = key === 'days' ? Number(t.value) : t.value; if (key === 'dim') c.value = ''; }
    if (scope === 'diag') { const w = ui.diagWin; ({ cur0: () => (w.cur[0] = t.value), cur1: () => (w.cur[1] = t.value), base0: () => (w.base[0] = t.value), base1: () => (w.base[1] = t.value) })[key](); ui.diag = null; }
    render(); return;
  }
  if (t.dataset.filter) { const f = ui.monitor.filters, k = t.dataset.filter; f[k] = [...document.querySelectorAll(`[data-filter="${k}"]:checked`)].map(i => i.value); render(); document.querySelector(`[data-filter="${k}"]`)?.closest('details')?.setAttribute('open', ''); return; }
  if (t.dataset.assume) { const [opp, rule, i] = t.dataset.assume.split('|'), key = `${opp}|${rule}`, o = opportunities(db).find(x => x.opportunity_id === opp), r = optionsFor(o.finding).find(x => x.id === rule);
    const cur = ui.assumptions[key]?.recover ?? r.recover, next = [...cur]; next[Number(i)] = Math.min(1, Math.max(0, Number(t.value) / 100)); if (next[0] > next[1]) next.reverse(); ui.assumptions[key] = { recover: next }; render(); return; }
  if (t.dataset.map !== undefined) { const d = ui.importDraft, mapping = { ...d.mapping }; if (t.value === '') delete mapping[t.dataset.map]; else mapping[t.dataset.map] = Number(t.value);
    setBusy(`Reading ${d.name}`, 'Validating with the new mapping');
    try { Object.assign(d, await ask('remap', { job: d.job, mapping, experimentId: d.experimentId })); } catch (error) { dropLostDraft(error); throw error; } finally { clearBusy(); render(); }
    return; }
  if (t.dataset.draft) { ui.importDraft[t.dataset.draft] = t.type === 'checkbox' ? t.checked : t.value.trim(); return; }
  if (t.dataset.sim) { ui.sim.effect = t.value; return; }
  if (t.dataset.act === 'file' && tour) { t.value = ''; tourLockedToast(); return; }
  if (t.dataset.act === 'file' && t.files[0]) { const f = t.files[0]; if (f.size > LIMITS.maxBytes) { ui.importDraft = { experimentId: t.dataset.id, name: f.name, fatal: `The file is larger than ${LIMITS.maxBytes / 1024 / 1024} MB.` }; render(); return; }
    await parseInto(t.dataset.id, { file: f, name: f.name }); }
});
                                                                                                                   
export function fieldKey(el) {
  const f = el.form?.dataset, form = f?.form ? `[data-form="${f.form}"]${f.id ? `[data-id="${CSS.escape(f.id)}"]` : ''} ` : '';
  for (const a of ['data-plan', 'data-tol', 'data-assume', 'data-draft', 'data-sim', 'name']) if (el.hasAttribute(a)) return `${form}[${a}="${CSS.escape(el.getAttribute(a))}"]`;
  return null;
}
export function keepDecision(form) {
  const el = form.elements;
  ui.decisionInput[form.dataset.id] = { evidenceId: form.dataset.evidence, v: el.v.value, ...Object.fromEntries(['rationale', 'alternatives', 'assumptions', 'changeMyMind', 'next', 'override'].filter(k => el[k]).map(k => [k, el[k].value])) };
}
document.addEventListener('input', ev => {
  const t = ev.target, key = /^(INPUT|TEXTAREA)$/.test(t.tagName) && !['checkbox', 'radio', 'file', 'date'].includes(t.type) ? fieldKey(t) : null;
  if (committed?.el === t) committed = null;                                                
  if (key) ui.typing = { key, value: t.value, focused: document.activeElement === t, start: t.selectionStart, end: t.selectionEnd };  if (t.form?.dataset.form === 'decision') { keepDecision(t.form); return; }
  if (t.dataset.plan) { const [id, key] = t.dataset.plan.split('|'); ui.planDraft[id][key] = t.value; const x = experiments(db).find(e => e.experiment_id === id), n = planNumbers(x, ui.planDraft[id]), el = document.getElementById('plan-calc');
    if (el) { el.className = n.short || n.err ? 'err' : 'small'; el.innerHTML = n.err ? esc(n.err) : `Needs <b>${num(n.perArm)}</b> checkouts per group → at least <b>${n.minDays}</b> days at current traffic. Ends ${n.end ? dayLabel(n.end) : '—'}.${n.short ? ' Too short to reach the sample: add days or raise the MDE.' : ''}`; }
    const btn = document.querySelector(`[data-act="freeze"][data-id="${id}"]`); if (btn) btn.disabled = !!(n.err || n.short); }
  if (t.dataset.tol) { const [id, g] = t.dataset.tol.split('|'); ui.planDraft[id].tol[g] = t.value; }
});
document.addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target, fd = new FormData(f);
  if (ui.busy) return;
  if (tour) { tourLockedToast(); return; }
  ui.typing = null;
  try {
    if (f.dataset.form === 'decision') { const id = f.dataset.id, draft = ui.decisionDraft[id] ?? {}, v = k => String(fd.get(k) ?? '').trim();
                                                                                                               
      const edited = ['rationale', 'alternatives', 'assumptions', 'changeMyMind'].some(k => v(k) !== String(draft[k] ?? '').trim()) || v('next') !== String(draft.nextBy?.[fd.get('v')] ?? '').trim()
        || (fd.get('v') === 'Planning Ready' && v('override') !== '');
      await recordDecision(db, { experimentId: id, verdict: fd.get('v'), rationale: v('rationale'), nextStep: v('next'), override: v('override'), notes: { alternatives: v('alternatives'), assumptions: v('assumptions'), changeMyMind: v('changeMyMind'), edited } }); if (await persist(edited ? 'Decision recorded in your words.' : 'Decision recorded. The text is still the system draft.')) delete ui.decisionInput[id]; }
    if (f.dataset.form === 'regen') { await loadSample({ seed: String(fd.get('seed') || 'pcl-sample-1'), dailyCheckouts: Number(fd.get('daily')) || 700 }); render(); toast('Sample regenerated. Opportunities and experiments were cleared.'); }
  } catch (error) { console.error(error); toast(friendly(error)); }
});
window.addEventListener('hashchange', () => {
                                                                                                                        
  if (ui.busy) { if (location.hash !== ui.busy.hash) history.replaceState(null, '', ui.busy.hash || '#/'); return; }
                                                                                                                       
  if (tour) tour.focused = false;
  ui.typing = null; render();
  if (!tour?.focused) window.scrollTo(0, 0);
});
                                                                                                             
matchMedia('(max-width: 640px)').addEventListener('change', () => render());
                                                                                                   
window.addEventListener('pcl:render', () => render());

                 
                                                                                                        
                                                                                                                           
                                                                                                                   
                                                                                                                              
                                                                                                                                  
                                                                  
async function openSaved(snap) {
  for (let attempt = 1; ; attempt++) {
    let up;
    try { up = upgrade(SQL, schemaSql, extSql, snap.bytes); } catch (error) {
      if (error.message === 'WORKSPACE_NOT_RECOGNISED') { const c = new SQL.Database(snap.bytes); refreshViews(c); legacy = { kind: 'unrecognised', snap, gaps: schemaGaps(c) }; c.close(); return null; }
      console.error('Workspace upgrade failed its checks', error); legacy = { kind: 'upgrade-failed', snap, reason: 'the upgraded copy did not pass its checks' }; return null;
    }
    if (up.from === up.to) { db = up.db; resetUi(); return null; }
    let outcome;
    try {
      const key = `pre-upgrade-v${up.from}-${snap.savedAt ?? 'unknown'}`;                                                               
      const next = { schema: SNAPSHOT, savedAt: new Date().toISOString(), bytes: up.db.export() };
      await window.pclTest?.beforeUpgradeWrite?.();                                                                     
      outcome = await idb('readwrite', st => replaceIfUnchanged(st, snap, key, next));
    } catch (error) {
      console.error('Saving the upgraded workspace failed', error); up.db.close();
      legacy = { kind: 'upgrade-failed', snap, reason: 'the browser did not store the safety copy or the upgraded workspace' }; return null;
    }
    if (outcome === 'stored') { db = up.db; resetUi(); return up; }
    up.db.close();
    if (attempt === 3) { legacy = { kind: 'upgrade-failed', snap, reason: 'another tab kept saving this workspace while it was being upgraded. Close the other tabs of this site and reload' }; return null; }
    snap = await idb('readonly', s => s.get(IDB.key));
    if (snap?.schema !== SNAPSHOT) return null;                                                                  
  }
}
                                                                                                                                      
                                                                                               
function replaceIfUnchanged(st, was, key, next) {
  const out = {}, cur = st.get(IDB.key);
  cur.onsuccess = () => {
    const c = cur.result, same = c && c.schema === was.schema && c.savedAt === was.savedAt && c.bytes?.length === was.bytes.length && c.bytes.every((b, i) => b === was.bytes[i]);
    if (!same) { out.result = 'changed'; return; }
    const kept = st.get(key);
                                                                                                                            
    kept.onsuccess = () => { try { if (!kept.result) st.put(was, key); st.put(next, IDB.key); out.result = 'stored'; } catch { try { st.transaction.abort(); } catch {                     } } };
  };
  return out;
}
try {
  SQL = await window.initSqlJs({ locateFile: f => VENDOR + f });
  [schemaSql, extSql] = await Promise.all(['store/schema.sql', 'store/schema-ext.sql'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error('Could not load ' + u); return r.text(); })));
  const snap = await idb('readonly', s => s.get(IDB.key)).catch(() => { storageOk = false; return null; });
  const upgraded = snap?.schema === SNAPSHOT ? await openSaved(snap) : null;
  render();
  if (upgraded) toast(`Workspace upgraded to data structure v${upgraded.to}. The original is kept in this browser.`);
  window.pclReady = true;
} catch (error) {
  console.error(error);
  $app.innerHTML = `<div class="boot callout fail"><b>The analysis engine could not start</b>${esc(error.message)}. Please refresh the page. If it still does not start, check your internet connection or open it in a recent version of Chrome or Edge.</div>`;
}
