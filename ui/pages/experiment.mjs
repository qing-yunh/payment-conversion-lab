                                                                           
import { requiredPerArm } from '../../domain/checkout-plan.mjs';
import { nextSteps } from '../../engine/advice.mjs';
import { DIMS, actionability, addDays, dataRange, defaultWindows, estimate, optionsFor, segFilter, totals } from '../../engine/analytics.mjs';
import { LIMITS, OPTIONAL, REQUIRED } from '../../engine/csv.mjs';
import { conclusion, stopCondition } from '../../engine/results.mjs';
import { OVERRIDE_MARK, RESULTS_POSITIVE, decisions, evidenceRecord, experiments, opportunities, plans, segLabel } from '../../store/store.mjs';
import { treatmentMock } from '../mocks.mjs';
import { metricOf, planNumbersIn } from '../plan-numbers.mjs';
import { sealSvg } from '../seal.mjs';
import { analysisOf, checkingPanel, db, decidedVoid, evidenceState, head, integrityOf, isVoid, needData, notFound, shell, tour, ui, voidPanel } from '../app.mjs';
import { lineChart } from '../charts.mjs';
import { dayLabel, esc, fold, gbp, icon, narrow, num, pct, pill, pp, pval, rate } from '../format.mjs';

export const stagePill = s => (s === 'Decided' ? pill('pass', s) : s === 'Design' ? pill('unknown', s) : pill('warn', s));
export const stagePillOf = x => (decidedVoid(x) ? (evidenceState(x.state.evidence_id) === 'historical' ? pill('unknown', 'Decided · historical evidence') : pill('fail', 'Decided · evidence void')) : stagePill(x.state.stage));
export const nextOf = x => (decidedVoid(x) ? (evidenceState(x.state.evidence_id) === 'historical' ? ['Freeze a new plan', 'plan'] : ['Import results again', 'results']) : NEXT[x.state.stage]);
                                                                                                                
                                                                                                                              
export const RULE_CHECKS = {
  'R-RT1': [['retry-rules', "Retries follow the card schemes' rules on retrying declined payments, as confirmed with the PSP"], ['retry-scope', 'Only soft declines are retried; declines for suspected fraud are never retried']],
  'R-RT2': [['alt-methods', 'The other payment methods offered are enabled for these shoppers, as confirmed with the PSP']],
  'R-SC2': [['sca-full', 'Strong Customer Authentication still applies in full; only how the challenge is presented changes, as confirmed with the PSP']],
};
export const reviewChecks = ruleId => [...(ruleId === 'R-SC2' ? [] : [['sca', 'Strong Customer Authentication flow is unchanged by the treatment']]),
  ['data', 'Fields the acquirer and fraud tools need are still collected'], ['a11y', 'Treatment meets WCAG 2.2 AA (labels, errors, keyboard)'], ...(RULE_CHECKS[ruleId] ?? [])];
                        
export function experimentsPage() {
  if (!db) return needData('experiments');
  const list = experiments(db);
  return shell('experiments', `${head('Experiments')}${list.length ? `<section class="panel"><div class="table-scroll"><table class="data"><thead><tr><th>ID</th><th>Experiment</th><th>Segment</th><th>Stage</th><th class="num">Result</th></tr></thead><tbody>
    ${list.map(x => { const ev = x.state.evidence_id ? evidenceRecord(db, x.state.evidence_id)?.evidence : null; return `<tr class="link" data-href="#/experiments/${x.experiment_id}/plan"><td class="mono">${x.experiment_id}</td><td><a href="#/experiments/${x.experiment_id}/plan"><b>${esc(x.title)}</b></a><div class="small muted">from ${x.opportunity_id}</div></td><td>${esc(segLabel(x.segment))}</td><td>${stagePillOf(x)}</td><td class="num">${ev?.statistics ? pp(ev.statistics.difference) : '—'}</td></tr>`; }).join('')}</tbody></table></div></section>`
    : `<div class="panel empty"><h2>No experiments yet</h2><p>Design one from an opportunity's options.</p><a class="btn primary" href="#/opportunities">Go to Opportunities</a></div>`}`);
}
export const STEP = { Design: 0, Planned: 1, Results: 1, 'Risk review': 2, Decision: 3, Decided: 4 };
export const NEXT = { Design: ['Freeze the plan', 'plan'], Planned: ['Import results', 'results'], Results: ['See why results are blocked', 'results'], 'Risk review': ['Review risk', 'risk'], Decision: ['Record decision', 'decision'], Decided: ['View decision', 'decision'] };
export function experimentPage(id, tab) {
  if (!db) return needData('experiments');
  const x = experiments(db).find(e => e.experiment_id === id);
  if (!x || !['plan', 'results', 'risk', 'decision'].includes(tab)) return notFound('experiments');
  const s = x.state, idx = STEP[s.stage], stepOf = { plan: 0, results: 1, risk: 2, decision: 3 };
  const tl = t => { const st = stepOf[t], cls = idx > st ? 'done' : ''; return `<a href="#/experiments/${id}/${t}" class="${cls}" ${t === tab ? 'aria-current="page"' : ''}>${cls ? icon('check') : ''}${t[0].toUpperCase() + t.slice(1)}</a>`; };
  const body = { plan: planTab, results: resultsTab, risk: riskTab, decision: decisionTab }[tab](x);
  return shell('experiments', `<div class="context"><a href="#/opportunities/${x.opportunity_id}">${x.opportunity_id}</a>${icon('chev')}<span class="mono">${x.hypothesis_id}</span>${icon('chev')}<span class="mono">${id}</span>${s.plan_version ? `${icon('chev')}<span class="mono">Plan v${s.plan_version}</span>` : ''}</div>
    <div class="page-head"><div><h1>${esc(x.title)}</h1><p class="small muted">${esc(x.statement)}</p></div><span class="spacer"></span>${stagePillOf(x)}<a class="btn primary" href="#/experiments/${id}/${nextOf(x)[1]}">${nextOf(x)[0]} ${icon('chev')}</a></div>
    <nav class="tabs" aria-label="Experiment sections">${['plan', 'results', 'risk', 'decision'].map(tl).join('')}</nav>${body}`);
}
                                                                                                   
export { metricOf };
                                                                                                       
const legacyNotice = (x, p, link = true) => `<div class="callout warn section" style="margin-top:0"><b>Plan v${p.planVersion} is a historical plan</b>It was frozen before plans recorded the problem, hypothesis and option they test. It stays as history with its evidence and decisions, but new results need a newly frozen plan.${link ? ` <a href="#/experiments/${x.experiment_id}/plan">Freeze a new plan</a>` : ''}</div>`;
export const planNumbers = (x, draft) => planNumbersIn(db, x, draft);
export function planTab(x) {
  const ps = plans(db, x.experiment_id), s = x.state, current = ps.find(p => p.fingerprint === s.plan_fingerprint);
  const f = opportunities(db).find(o => o.opportunity_id === x.opportunity_id)?.finding, est = f ? estimate(db, f, x.rule, f.window ?? ui.diagWin, ui.assumptions[`${x.opportunity_id}|${x.rule_id}`] ?? {}) : null;
  const d = ui.planDraft[x.experiment_id] ??= { mde: est?.mde ?? 2, start: addDays(dataRange(db).last, 1), days: est?.testDays ? Math.ceil(est.testDays * 1.1) : 28, tol: Object.fromEntries(x.guardrails.filter(g => g.tolerance !== null).map(g => [g.id, g.tolerance])) };
  const n = planNumbers(x, d);
  const form = `<section class="panel pad stack" id="plan-form"><h2>${current ? 'Freeze a new plan version' : 'Plan'}</h2>
    <dl class="kv"><dt>Option</dt><dd>${esc(x.rule.title)} <span class="mono small">${x.rule.id}</span></dd><dt>Eligible checkouts</dt><dd>${esc(segLabel(x.segment))} · ≈ ${num(n.daily)} a day</dd>
    <dt>Primary metric</dt><dd>${metricOf(x).label} within ${metricOf(x).window} minutes (${metricOf(x).id})</dd><dt>Baseline</dt><dd>${rate(n.base, 2)} <span class="small muted">${num(n.t[metricOf(x).num])} / ${num(n.t.started)}, last 28 days</span></dd>
    <dt>α / power / split</dt><dd>0.05 / 0.80 / 50:50 by checkout <span class="small muted">— fixed by the approved method</span></dd></dl>
    <div class="row"><label class="field">Smallest effect to detect (pp)<input type="number" step="0.1" min="0.1" max="20" value="${d.mde}" data-plan="${x.experiment_id}|mde"></label>
      <label class="field">Enrolment starts<input type="date" value="${d.start}" data-plan="${x.experiment_id}|start"></label>
      <label class="field">Enrolment days<input type="number" min="1" max="365" value="${d.days}" data-plan="${x.experiment_id}|days"></label></div>
    <p id="plan-calc" class="${n.short || n.err ? 'err' : 'small'}">${n.err ? esc(n.err) : `Needs <b>${num(n.perArm)}</b> checkouts per group → at least <b>${n.minDays}</b> days at current traffic. Ends ${n.end ? dayLabel(n.end) : '—'}.${n.short ? ' Too short to reach the sample: add days or raise the MDE.' : ''}`}</p>
    ${current ? '' : `<h3>Guardrails and tolerances</h3><table class="data small"><tbody>${x.guardrails.map(g => `<tr><td>${esc(g.label)}</td><td>${g.kind === 'risk' ? '<span class="muted">Unverified risk item: no test on this data; a required check in a real experiment</span>' : g.tolerance === null ? '<span class="muted">No data during the test — carried forward</span>' : `stop if worse than −<input type="number" step="0.1" min="0" value="${d.tol[g.id]}" data-tol="${x.experiment_id}|${g.id}" aria-label="${esc(g.label)} tolerance"> ${g.unit}`}</td></tr>`).join('')}</tbody></table>`}
    <div class="row"><button class="btn primary" data-act="freeze" data-id="${x.experiment_id}" ${n.err || n.short ? 'disabled' : ''}>${current ? 'Freeze new version' : 'Freeze plan'}</button><span class="small muted">A frozen plan can't be edited; changes create a new version.</span></div></section>`;
  const mock = treatmentMock(x.rule_id), mockHtml = mock ? `<details class="panel pad section"><summary><b>What A and B will look like</b> <span class="small muted">· illustrative wireframe of ${x.rule.id}</span></summary><div class="stack" style="margin-top:12px">${mock}</div></details>` : '';
  if (!current) return form + mockHtml;
  const old = ps.filter(p => p !== current), legacy = current.schema === 'pcl-checkout-plan-v1' ? legacyNotice(x, current, false) : '';                                              
  return `${legacy}<div class="grid2"><section class="panel pad stack" id="plan-seal"><div class="sealrow">${sealSvg(current.fingerprint, 'v' + current.planVersion, { draw: ui.animateSeal === current.fingerprint })}<div><h2>Plan v${current.planVersion} sealed</h2>
    <div class="small muted">${new Date(current.frozenAt).toUTCString().slice(5, 22)} UTC</div><div class="fp">SHA-256 ${current.fingerprint.match(/.{8}/g).slice(0, 4).join(' ')}</div></div></div>
    <dl class="kv small"><dt>Baseline</dt><dd>${rate(current.baselineRate, 2)}</dd><dt>MDE</dt><dd>${current.mdePP} pp</dd><dt>Needed</dt><dd><b>${num(current.requiredPerArm)}</b> per group</dd>
    <dt>Primary metric</dt><dd>${current.metricId ?? 'PAYMENT_SUBMISSION_30M_ITT'}</dd>
    <dt>Enrolment</dt><dd>${dayLabel(current.enrollmentStart.slice(0, 10))} – ${dayLabel(current.enrollmentEnd.slice(0, 10))}, then ${current.observationWindowMinutes}-minute window</dd><dt>Eligible</dt><dd>${esc(segLabel(x.segment))}</dd>
    <dt>Guardrails</dt><dd>${x.guardrails.map(g => esc(g.label) + (g.kind === 'risk' ? ' (unverified risk item)' : g.tolerance !== null ? ` (−${g.tolerance} ${g.unit})` : ' (no data)')).join(' · ')}</dd></dl></section>
    <div class="stack">${form}${mockHtml}${old.map(p => `<section class="panel pad voidable is-void"><h3 class="strike">Plan v${p.planVersion} · MDE ${p.mdePP} pp · ${num(p.requiredPerArm)} per group</h3><p class="small" style="color:var(--void);font-weight:600">Superseded by Plan v${current.planVersion}</p></section>`).join('')}</div></div>`;
}

export function importPanel(x, plan) {
  if (plan.schema === 'pcl-checkout-plan-v1') return legacyNotice(x, plan);                                                        
  const dr = ui.importDraft?.experimentId === x.experiment_id ? ui.importDraft : null, win = plan.observationWindowMinutes;
  const cols = [...REQUIRED, ...OPTIONAL], horizon = new Date(Date.parse(plan.enrollmentEnd) + win * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `<div class="grid2"><section class="panel pad stack"><h2>Import results</h2>
    <p class="small muted">One row per checkout attempt, exported from where the test ran. Required columns: ${REQUIRED.join(', ')}. Card numbers are refused.</p>
    <label class="btn" style="align-self:flex-start">${icon('upload')} Choose CSV file<input type="file" accept=".csv,text/csv" data-act="file" data-id="${x.experiment_id}" class="visually-hidden"></label>
    ${dr ? dr.fatal ? `<p class="callout fail"><b>File not imported</b>${esc(dr.fatal)}</p>` : `
      <p class="small"><b>${esc(dr.name)}</b> · ${num(dr.rowCount)} rows</p>
      <details ${dr.validation.errorCount || REQUIRED.some(k => dr.mapping[k] === undefined) ? 'open' : ''}><summary class="small">Column mapping</summary><table class="data small"><tbody>${cols.map(c => `<tr><td class="mono">${c}${REQUIRED.includes(c) ? ' *' : ''}</td><td><select data-map="${c}"><option value="">—</option>${dr.header.map((h, i) => `<option value="${i}" ${dr.mapping[c] === i ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></details>
      ${dr.validation.errorCount ? `<div class="callout fail"><b>${num(dr.validation.errorCount)} problem${dr.validation.errorCount > 1 ? 's' : ''} to fix</b><ul class="small" style="margin:4px 0 0;padding-left:18px">${dr.validation.errors.slice(0, LIMITS.maxErrorsShown).map(e => `<li>Line ${e.line}: ${esc(e.message)}</li>`).join('')}</ul></div>`
        : `<p class="callout pass"><b>Ready to import</b>${num(dr.validation.stats.rows)} rows · ${num(dr.validation.stats.checkouts)} checkouts · last event ${esc(dr.validation.stats.lastEvent)}</p>
      <div class="row"><label class="field">Data complete up to (UTC)<input type="text" value="${esc(dr.coverage)}" data-draft="coverage" size="22"></label>
        <label class="row small"><input type="checkbox" data-draft="complete" ${dr.complete ? 'checked' : ''}>I confirm every event up to this time is in the file</label></div>
      <p class="small muted">The time alone cannot prove nothing is missing, so ${dr.sample ? 'this generated file is complete by construction' : 'tick the box only if your export is complete'}. Unticked, or earlier than ${esc(horizon)} (end of enrolment plus the ${win}-minute window), the result stays "Need more evidence".</p>
      <button class="btn primary" data-act="import" data-id="${x.experiment_id}">Import and analyse</button>`}` : ''}</section>
    <section class="panel pad stack"><h2>No results yet?</h2><p class="small muted">Generate a synthetic results file for this plan. You choose the true effect, so you can see a winning, a null and a harmful result go through the same checks.</p>
      <label class="field">Simulated true effect on ${metricOf(x).short} (pp)<input type="number" step="0.5" min="-10" max="10" value="${ui.sim.effect}" data-sim="effect"></label>
      <div class="row"><button class="btn" data-act="sim-download" data-id="${x.experiment_id}">${icon('download')} Download sample CSV</button><button class="btn" data-act="sim-use" data-id="${x.experiment_id}">Use sample now</button></div>
      <p class="small muted">Plan v${plan.planVersion}: ${dayLabel(plan.enrollmentStart.slice(0, 10))} – ${dayLabel(plan.enrollmentEnd.slice(0, 10))}, ${esc(segLabel(x.segment).toLowerCase())}.</p></section></div>`;
}
                                                                                                     
                                                                                                                                
                                                                                                                      
export const SOURCE_BADGE = { simulated: 'Simulated results · synthetic', unverified: 'Source not verified · synthetic workspace' };
export const sourceOf = experimentId => (tour && experimentId === tour.expId ? 'simulated' : 'unverified');
export const SOURCE_TEXT = {
  simulated: 'Simulated by the tour for this read-only case, for its frozen plan, from the synthetic sample history. Not observed behaviour.',
  unverified: 'Not verified. This version does not record where imported results came from, so a file name is never taken as proof of the source, even one that looks like a file this product made. This workspace is a synthetic demonstration; the results are not verified real data either.',
};
export const verdictPill = g => pill(g.verdict === 'Pass' ? 'pass' : g.verdict === 'Fail' ? 'fail' : g.verdict === 'Inconclusive' ? 'warn' : 'unknown', g.verdict);
export function resultsTab(x) {
  const s = x.state, plan = plans(db, x.experiment_id).find(p => p.fingerprint === s.plan_fingerprint);
  if (!plan) return `<div class="panel empty"><h2>Freeze a plan first</h2><p>Results are always read against a frozen plan, so the success rule can't move after the data arrives.</p><a class="btn primary" href="#/experiments/${x.experiment_id}/plan">Go to Plan</a></div>`;
  if (!s.evidence_id || ui.forceImport === x.experiment_id) return importPanel(x, plan);
  const integrity = integrityOf(s.evidence_id);
  if (isVoid(s.evidence_id)) return voidPanel(x);
  const a = analysisOf(s.evidence_id); if (!a) return checkingPanel();                                                     
  const { evidence: ev, imported } = evidenceRecord(db, s.evidence_id), c = conclusion(ev, a), st = ev.statistics;
  const health = [integrity === 'checking' ? pill('unknown', 'Checking data integrity…') : pill('pass', 'Data matches the import'),
    ev.sampleSufficient ? pill('pass', `Sample ${num(ev.counts.A.assigned)} / ${num(ev.counts.B.assigned)} of ${num(plan.requiredPerArm)} per group`) : pill('fail', `Sample ${num(ev.counts.A.assigned)} / ${num(ev.counts.B.assigned)} of ${num(plan.requiredPerArm)} per group`),
    ev.srmP === null ? pill('unknown', 'SRM not computable') : ev.srmP < 0.001 ? pill('fail', `Unbalanced groups · SRM p ${pval(ev.srmP)}`) : pill('pass', `Groups balanced · SRM p ${ev.srmP.toFixed(2)}`),
    ev.need.some(n => /PENDING|INCOMPLETE|COVERAGE/.test(n)) ? pill('warn', 'Window or coverage not complete') : pill('pass', `Full ${plan.observationWindowMinutes}-minute window, coverage confirmed`),
    ...ev.warnings.map(w => pill('warn', w === 'MISSING_EXPOSURE_RETAINED_IN_ITT' ? 'Some exposures missing · kept (ITT)' : w))];
  const fmt = (m, v) => (m.money ? gbp(v) : rate(v, 2));
  const bars = st ? (() => { const small = narrow(), W = small ? 170 : 300, max = Math.max(ev.rates.A, ev.rates.B) * 1.08, lo = Math.min(ev.rates.A, ev.rates.B) * 0.92, xs = v => (v - lo) / (max - lo) * W;
    return `<svg viewBox="-92 0 ${W + (small ? 156 : 150)} 96" style="width:100%;height:auto" font-size="${small ? 13 : 12}" font-family="var(--font)" fill="var(--ink)" role="img" aria-label="${metricOf(x).label} by group">${[['A · control', ev.rates.A, 'var(--a)'], ['B · treatment', ev.rates.B, 'var(--b)']].map(([l, v, col], i) =>
      `<text x="-8" y="${28 + i * 40}" text-anchor="end">${l}</text><rect x="0" y="${14 + i * 40}" width="${xs(v)}" height="22" fill="${col}" rx="3"/><text x="${xs(v) + 8}" y="${30 + i * 40}" font-weight="700">${rate(v, 2)}</text>`).join('')}</svg>`; })() : '';
  const next = s.stage === 'Risk review' ? `<a class="btn primary" href="#/experiments/${x.experiment_id}/risk">Review risk ${icon('chev')}</a>` : !a.checked ? `<a class="btn" data-act="reimport" data-id="${x.experiment_id}" href="#">Import a corrected or newer file</a>` : '';
  const opp = opportunities(db).find(o => o.opportunity_id === x.opportunity_id), f = opp?.finding, fw = f?.window ?? ui.diagWin, assume = r => ui.assumptions[`${x.opportunity_id}|${r.id}`] ?? {};
  const est = f ? estimate(db, f, x.rule, fw, assume(x.rule)) : null, segT = totals(db, segFilter(x.segment), ...defaultWindows(db).cur);
  const alternatives = f ? optionsFor(f).filter(r => r.id !== x.rule_id).map(r => ({ r, e: estimate(db, f, r, fw, assume(r)) })).sort((p, q) => (q.e.valueMid ?? -1) - (p.e.valueMid ?? -1))
    .map(({ r, e }) => ({ title: r.title, valueMid: e.estimable ? e.valueMid : null, kind: actionability(r), href: `#/opportunities/${x.opportunity_id}` })) : [];
  const advice = nextSteps({ evidence: ev, analysis: a, plan, assumedPP: est?.estimable ? est.upliftPP : null, alternatives, missingEvidence: f?.missing ?? [], daily: segT.started / 28, labels: DIMS.payment_method.values,
    explicitUnknown: a.explicitUnknown });
  const TAG = { do: ['pass', 'Do'], check: ['warn', 'Check'], consider: ['unknown', 'Consider'], avoid: ['fail', 'Avoid'] }, mock = treatmentMock(x.rule_id);
  const adviceHtml = `<section class="panel pad stack"><div class="row"><h2>What to do next</h2><span class="spacer"></span><span class="badge">Suggestions · the decision is yours</span></div>
    <ol class="advice">${advice.map(st => `<li><span class="adv-tag ${TAG[st.tone][0]}">${TAG[st.tone][1]}</span><div><b>${esc(st.title)}</b><p class="small">${esc(st.text)}</p>${st.href ? `<a class="small" href="${st.href}">${esc(st.link)}</a>` : ''}</div></li>`).join('')}</ol></section>`;
  const mockHtml = mock ? `<section class="panel pad stack"><div class="row"><h2>What A and B looked like</h2><span class="spacer"></span><span class="badge">Illustrative wireframe</span></div>${mock}
    <p class="small muted">Drawn from the option's specification (${x.rule.id}), not a screenshot of a real checkout. The treatment design review checks the real screens.</p></section>` : '';
  const segRows = [...a.segments.channel.map(r => ({ ...r, l: DIMS.channel.values[r.value] ?? r.value })), ...a.segments.payment_method.map(r => ({ ...r, l: DIMS.payment_method.values[r.value] ?? r.value }))].filter(r => r.a[1] && r.b[1]);
  return `<div class="stack"><section class="panel pad stack"><h2>Can these data be trusted?</h2><div class="row">${health.join('')}</div></section>
    <div class="callout ${c.tone}"><b>${esc(c.title)}</b>${esc(c.text)}<div style="margin-top:10px">${next}</div></div>
    ${adviceHtml}
    <section class="panel"><div class="pad row"><h2>A vs B</h2><span class="spacer"></span><span class="badge">${SOURCE_BADGE[sourceOf(x.experiment_id)]}${tour && x.experiment_id === tour.expId ? ` · true effect set to +${tour.effect} pp` : ''}</span></div><div class="table-scroll"><table class="data"><thead><tr><th>Metric</th><th class="num">A</th><th class="num">B</th><th class="num">B − A</th><th class="num">95% CI</th><th class="num">p</th></tr></thead><tbody>
      ${a.checked ? '' : '<tr><td colspan="6" class="small muted">Counts only: no rates, differences or p-values until the evidence passes its checks.</td></tr>'}${a.metrics.map(m => `<tr class="${m.primary ? 'primary' : ''}"><td>${m.primary ? '<b>' : ''}${esc(m.label)}${m.primary ? '</b>' : ''}${m.missing && a.checked ? `<div class="small" style="color:var(--warn)">${esc(m.missing)}</div>` : ''}</td><td class="num">${m.test ? fmt(m, m.test.p1) : '—'}<div class="small muted">${m.money ? num(m.a[1]) + ' orders' : num(m.a[0]) + ' / ' + num(m.a[1])}</div></td><td class="num">${m.test ? fmt(m, m.test.p2) : '—'}<div class="small muted">${m.money ? num(m.b[1]) + ' orders' : num(m.b[0]) + ' / ' + num(m.b[1])}</div></td>
        <td class="num ${m.test && (m.test.ci[0] > 0 ? 'up' : m.test.ci[1] < 0 ? 'down' : 'flat')}">${m.test ? (m.money ? (m.test.diff >= 0 ? '+' : '−') + gbp(Math.abs(m.test.diff)) : pp(m.test.diff)) : '—'}</td><td class="num muted">${m.test ? (m.money ? `${gbp(m.test.ci[0])} to ${gbp(m.test.ci[1])}` : `${pp(m.test.ci[0], 2)} to ${pp(m.test.ci[1], 2)}`) : '—'}</td><td class="num muted">${m.test?.p !== undefined ? pval(m.test.p) : '—'}</td></tr>`).join('')}</tbody></table></div></section>
    ${fold('What A and B looked like', mockHtml)}
    ${a.checked ? fold('Charts: by group, daily and cumulative', `<div class="grid2"><section class="panel pad"><h2>${metricOf(x).label} by group</h2>${bars}<p class="small muted">Difference ${pp(st.difference)} · 95% CI ${pp(st.ci95[0])} to ${pp(st.ci95[1])} · p ${pval(st.pValue)}</p></section>
      <section class="panel pad"><h2>Daily ${metricOf(x).short} rate</h2>${lineChart({ series: [{ label: 'A', color: 'var(--a)', points: a.daily.map(r => [r.day, r.A]) }, { label: 'B', color: 'var(--b)', points: a.daily.map(r => [r.day, r.B]) }], height: 200, width: 460, label: `Daily ${metricOf(x).short} rate by group` })}</section></div>
      <section class="panel pad"><h2>Cumulative difference B − A</h2>${lineChart({ series: [{ label: 'B − A', color: 'var(--ink)', points: a.cumulative.map(r => [r.day, r.diff]) }], band: a.cumulative.map(r => ({ day: r.day, lo: r.ci[0], hi: r.ci[1] })), zero: true, height: 170, yFmt: v => (v * 100).toFixed(1) + ' pp', label: 'Cumulative difference with 95% CI' })}
      <p class="small muted">For monitoring only. The decision uses the fixed horizon in the plan, not an early peek.</p></section>`)
      : `<p class="note">Charts of rates and differences appear once the evidence passes its checks. Checkouts assigned so far: A ${num(a.daily.reduce((t, r) => t + r.nA, 0))}, B ${num(a.daily.reduce((t, r) => t + r.nB, 0))}.</p>`}
    <section class="panel"><div class="pad"><h2>Guardrails</h2><p class="small muted">Pass needs the 95% interval to rule out harm beyond the tolerance. Inconclusive and Unknown do not block Planning Ready, but become stop conditions for a real test; any Fail blocks it.</p></div>
      <div class="table-scroll"><table class="data"><thead><tr><th>Guardrail</th><th>Tolerance</th><th>Verdict</th><th>Reason</th></tr></thead><tbody>${a.guardrails.map(g => `<tr><td><b>${esc(g.label)}</b></td><td>${g.tolerance !== null ? (g.unit === 'pp' ? `−${g.tolerance} pp` : `−£${g.tolerance}`) : '—'}</td><td>${verdictPill(g)}</td><td class="small">${esc(g.reason)}</td></tr>`).join('')}</tbody></table></div></section>
    ${a.risks?.length ? `<section class="panel pad stack"><h2>Unverified risk items</h2><p class="small muted">Not guardrails: no test on this data, never a pass. Each is a required check in a real experiment.</p><ul class="small" style="margin:0;padding-left:18px">${a.risks.map(r => `<li><b>${esc(r.label)}</b>: ${esc(r.reason)}</li>`).join('')}</ul></section>` : ''}
    <details class="panel pad"><summary>Funnel and segments (exploratory)</summary><div class="grid2" style="margin-top:12px"><div class="funnel"><span></span><b class="small">A</b><b class="small">B</b>${a.funnel[0].steps.map(([l], i) => `<span>${l}</span>${a.funnel.map(fv => (a.checked ? `<div><div class="bar ${fv.variant === 'B' ? 'b' : ''}"><span style="width:${(fv.steps[i][1] / fv.steps[0][1] * 100).toFixed(1)}%"></span></div><span class="small muted">${pct(fv.steps[i][1], fv.steps[0][1])}</span></div>`
        : `<div><span class="small">${num(fv.steps[i][1])}</span></div>`)).join('')}`).join('')}</div>
      <table class="data small"><thead><tr><th>Segment</th><th class="num">A</th><th class="num">B</th><th class="num">B − A</th></tr></thead><tbody>${segRows.map(r => `<tr><td>${esc(r.l)}</td><td class="num">${a.checked ? pct(...r.a) : num(r.a[1])}</td><td class="num">${a.checked ? pct(...r.b) : num(r.b[1])}</td><td class="num">${r.test ? pp(r.test.diff, 1) : '—'}</td></tr>`).join('')}</tbody></table></div>
      <p class="small muted">Segment rows are not pre-registered tests.${a.checked ? '' : ' Funnel and segments show counts only until the evidence passes its checks.'}</p></details>
    <details class="panel pad" id="evidence-binding"><summary>Evidence binding and import</summary><dl class="kv small" style="margin-top:10px"><dt>Evidence</dt><dd class="mono">${ev.id} · ${esc(ev.evidenceStatus)}</dd><dt>Plan</dt><dd class="mono">v${ev.binding.planVersion} · ${ev.binding.planFingerprint.slice(0, 16)}…</dd>
      <dt>Dataset</dt><dd class="mono">${esc(ev.binding.datasetId)} v${ev.binding.datasetVersion} · ${ev.binding.datasetFingerprint.slice(0, 16)}…</dd><dt>Import fingerprint</dt><dd class="mono">${imported.import_fingerprint.slice(0, 16)}… (all fields + ${esc(imported.rules_version)})</dd>
      <dt>File</dt><dd>${esc(imported.file_name)} · ${num(imported.row_count)} rows</dd><dt>Source</dt><dd>${esc(SOURCE_TEXT[sourceOf(x.experiment_id)])}</dd><dt>Cut-off</dt><dd>${esc(ev.asOf)}</dd></dl></details></div>`;
}
export function riskTab(x) {
  const s = x.state;
  if (!s.evidence_id || s.evidence_status !== 'Synthetic Evidence Checked') return `<div class="panel empty"><h2>No checked evidence to review yet</h2><p>The evidence review is tied to one analysis that passed its data checks.</p><a class="btn primary" href="#/experiments/${x.experiment_id}/results">Go to Results</a></div>`;
  if (isVoid(s.evidence_id)) return voidPanel(x);
  const a = analysisOf(s.evidence_id); if (!a) return checkingPanel();
  const { evidence: ev } = evidenceRecord(db, s.evidence_id), fail = a.guardrails.some(g => g.verdict === 'Fail'), carried = a.guardrails.filter(g => g.carry);
  return `<div class="grid2" id="reviews"><section class="panel pad stack"><div class="row"><h2>Treatment design review</h2><span class="spacer"></span>${s.design_review_id ? pill(s.design_outcome === 'Pass' ? 'pass' : 'fail', `${s.design_outcome} · ${s.design_review_id}`) : pill('unknown', 'Not recorded')}</div>
      <p class="small muted">Bound to the experiment revision; survives an MDE-only plan change.</p>
      ${s.design_review_id ? '' : `<fieldset class="stack small" data-id="${x.experiment_id}">${reviewChecks(x.rule_id)
        .map(([k, t]) => `<label class="row"><input type="checkbox" data-check="${k}" ${ui.riskChecks[x.experiment_id]?.includes(k) ? 'checked' : ''}> ${t}</label>`).join('')}</fieldset>
      <div class="row"><button class="btn primary" data-act="design-review" data-id="${x.experiment_id}" data-outcome="Pass">Record: Pass</button><button class="btn danger" data-act="design-review" data-id="${x.experiment_id}" data-outcome="Fail">Record: Fail</button></div><p class="small muted">Pass needs all ${reviewChecks(x.rule_id).length} checks ticked.${RULE_CHECKS[x.rule_id] ? ' The option-specific checks are confirmations to get from their owners; this page gives no compliance verdict.' : ''}</p>`}</section>
    <section class="panel pad stack"><div class="row"><h2>Evidence review</h2><span class="spacer"></span>${s.evidence_review_id ? pill(s.evidence_outcome === 'Pass' ? 'pass' : 'fail', `${s.evidence_outcome} · ${s.evidence_review_id}`) : pill('unknown', 'Not recorded')}</div>
      <p class="small muted">Bound to ${ev.id}; new evidence never inherits it. Any Fail blocks Planning Ready; Inconclusive and Unknown are carried into the real test as stop conditions.</p>
      <table class="data small"><tbody>${a.guardrails.map(g => `<tr><td>${esc(g.label)}</td><td>${verdictPill(g)}</td><td class="muted">${g.carry ? esc(stopCondition(g)) : esc(g.level)}</td></tr>`).join('')}
        ${(a.risks ?? []).map(r => `<tr><td>${esc(r.label)}</td><td>${pill('unknown', 'Unverified risk')}</td><td class="muted">required check in a real experiment</td></tr>`).join('')}</tbody></table>
      ${s.evidence_review_id ? '' : `<button class="btn primary" data-act="evidence-review" data-id="${x.experiment_id}" data-outcome="${fail ? 'Fail' : 'Pass'}">Record: ${fail ? 'Fail' : `Pass${carried.length ? `, ${carried.length} carried forward as stop conditions` : ''}`}</button>`}</section></div>`;
}
                                                                                                      
const readingOf = id => { const a = analysisOf(id), rec = a && evidenceRecord(db, id); return rec ? conclusion(rec.evidence, a) : null; };
                                                                                                         
                                                                                                                                 
                                                                                                         
export const verdictFor = (reading, gate) => (gate && reading?.title === RESULTS_POSITIVE ? 'Planning Ready' : reading?.title === 'B is worse' ? 'Stop / Blocked' : 'Need More Evidence');
export function defaultVerdict(x) {
  const s = x.state, gate = s.planning_ready_allowed === 1 && integrityOf(s.evidence_id)?.ok === true;
  return verdictFor(readingOf(s.evidence_id), gate);
}
                                                                                                                                
                                                                                                    
export const overrides = rec => !!rec.override_reason || String(rec.rationale ?? '').startsWith(OVERRIDE_MARK);
export function decisionDraft(x) {
  const s = x.state;
  if (!s.evidence_id) return { rationale: '', next: '', nextBy: {}, alternatives: '', assumptions: '', changeMyMind: '' };
  const a = analysisOf(s.evidence_id), { evidence: ev } = evidenceRecord(db, s.evidence_id), carried = a.guardrails.filter(g => g.carry);
  const o = opportunities(db).find(p => p.opportunity_id === x.opportunity_id), f = o?.finding, w = f?.window ?? ui.diagWin;
  const others = f ? optionsFor(f).filter(r => r.id !== x.rule_id).map(r => { const e = estimate(db, f, r, w, ui.assumptions[`${x.opportunity_id}|${r.id}`] ?? {}); return `${r.title} (${actionability(r).toLowerCase()}${e.estimable ? `, est. ${gbp(e.valueMid)} a week` : ''})`; }) : [];
  const approvalGuard = x.guardrails.find(g => g.id === 'approval');
  const stops = [...carried.map(stopCondition), ...(approvalGuard ? [`stop if ${approvalGuard.label.toLowerCase()} falls by more than ${approvalGuard.tolerance} pp`] : []),
    ...(a.risks ?? []).map(r => `check ${r.label.toLowerCase()}, which this data could not verify`)];
                                                                                                              
  const c = conclusion(ev, a), fails = a.guardrails.filter(g => g.verdict === 'Fail').map(g => g.label.toLowerCase());
  const todo = [ev.evidenceStatus !== 'Synthetic Evidence Checked' && 'complete the evidence checks listed on the Results page and import the results again',
    !isVoid(s.evidence_id) || 'import the results again, because the current file no longer matches its import or the analysis rules',
    fails.length && `find out why ${fails.join(' and ')} fell; a changed B is a new treatment revision with its own design review and a new frozen plan`,
    s.design_outcome !== 'Pass' && 'record a passed treatment design review',
    ev.evidenceStatus === 'Synthetic Evidence Checked' && !fails.length && s.evidence_outcome !== 'Pass' && 'record the evidence review'].filter(t => typeof t === 'string');
  const nextBy = {
    'Planning Ready': `Prepare a real experiment for “${x.title}” on ${segLabel(x.segment).toLowerCase()}: get sign-off from the checkout, payments and risk owners, then run it with these stop conditions: ${[...new Set(stops)].join('; ')}.`,
    'Need More Evidence': `Before deciding again: ${todo.length ? todo.join('; ') : 'gather the evidence still missing for this option'}. Then review the evidence and record a new decision.`,
    'Stop / Blocked': `Stop “${x.title}”: do not prepare a real test (${c.title.toLowerCase()}). Keep the record, and look at the other options for this problem.`,
  };
  return {
    rationale: c.text + ' Synthetic data: a demonstration of the method, not evidence of real behaviour.',
    next: nextBy[defaultVerdict(x)], nextBy,
    alternatives: others.length ? `Considered and not chosen now: ${others.join('; ')}.` : 'No other option from the playbook for this problem.',
    assumptions: `The cause is still a hypothesis (${(f?.candidates ?? []).slice(0, 2).join('; ').toLowerCase()}). The value estimate assumes new payments behave like past ones. ${carried.length ? `Not cleared by data: ${carried.map(g => g.label.toLowerCase()).join(', ')}.` : ''}`.trim(),
                                                                                                                                 
                                                                                              
    changeMyMind: 'A real experiment that does not provide sufficient evidence of a worthwhile benefit (what counts as worthwhile is agreed, with its cost and risk, before it starts); any stop condition being hit; evidence of a different cause (for example a page error or traffic shift).',
  };
}
export function decisionTab(x) {
  const s = x.state;
  const rec = s.decision_id ? decisions(db).find(d => d.decision_id === s.decision_id) : null;
  const recVoid = rec && isVoid(rec.evidence_id);
  if (rec) return `${recVoid ? `<div class="callout fail section" style="margin-top:0"><b>This decision is no longer a current conclusion</b>Its evidence ${esc(rec.evidence_id)} ${evidenceState(rec.evidence_id) === 'historical' ? `is historical evidence (analysis rules ${esc(ui.integrity[rec.evidence_id]?.rulesVersion)}), kept as it was` : `no longer matches the imported file (${esc(ui.integrity[rec.evidence_id]?.rulesVersion)})`}. ${rec.verdict === 'Planning Ready' ? 'It is not a current approval to prepare a real experiment.' : ''} The record below is kept as what was decided at the time. Import the results again, review the evidence and decide again.<div style="margin-top:10px"><a class="btn" data-act="reimport" data-id="${x.experiment_id}" href="#">Import again</a></div></div>` : ''}
    <section class="panel pad stack"><div class="row"><h2>Decision ${rec.decision_id}</h2>${recVoid ? pill('unknown', `${rec.verdict} · not current`) : pill(rec.verdict === 'Planning Ready' ? 'pass' : rec.verdict === 'Stop / Blocked' ? 'fail' : 'warn', rec.verdict)}${overrides(rec) ? pill('warn', 'Overrides the results recommendation') : ''}${rec.authored_by ? `<span class="small muted">${esc(rec.authored_by)}</span>` : ''}</div>
    <dl class="kv"><dt>Bound to</dt><dd class="mono small">Plan ${rec.plan_fingerprint.slice(0, 8)} · ${rec.evidence_id} · ${rec.design_review_id} · ${rec.evidence_review_id}</dd>${rec.override_reason ? `<dt>Overrides the results recommendation</dt><dd>The results said “${esc(rec.override_reading)}”. Reason: ${esc(rec.override_reason)}${rec.override_source === 'recorded' ? '' : ' <span class="small muted">(read from the rationale text when this workspace was upgraded; the text below is unchanged)</span>'}</dd>` : ''}<dt>Why</dt><dd>${esc(rec.rationale)}</dd>
    ${rec.alternatives ? `<dt>Alternatives considered</dt><dd>${esc(rec.alternatives)}</dd><dt>Still assumptions</dt><dd>${esc(rec.assumptions)}</dd><dt>What would change my mind</dt><dd>${esc(rec.change_my_mind)}</dd>` : ''}
    <dt>Next step</dt><dd>${esc(rec.next_step)}</dd><dt>Recorded</dt><dd>${new Date(rec.decided_ms).toUTCString().slice(5, 22)} UTC</dd></dl>
    <p class="small muted">Planning Ready means: prepare an independent experiment on real traffic, after approvals. It is never a rollout approval.</p></section>`;
                                                                                                                                     
  if (integrityOf(s.evidence_id) === 'checking' || (s.evidence_id && !analysisOf(s.evidence_id) && !isVoid(s.evidence_id))) return checkingPanel();
  if (isVoid(s.evidence_id)) return voidPanel(x);                                                   
  const intact = integrityOf(s.evidence_id)?.ok === true;
  const items = [['Evidence checked for the current plan', s.evidence_status === 'Synthetic Evidence Checked'], ['Evidence still matches its import and the current analysis rules', intact],
    ['Treatment design review passed', s.design_outcome === 'Pass'], ['Evidence review passed (no guardrail failed)', s.evidence_outcome === 'Pass']];
  const gate = s.planning_ready_allowed === 1 && intact, d = ui.decisionDraft[x.experiment_id] = decisionDraft(x);
                                                                                                                      
  const kept = ui.decisionInput[x.experiment_id]?.evidenceId === s.evidence_id ? ui.decisionInput[x.experiment_id] : null;
  const val = k => kept?.[k] ?? d[k], verdict = kept?.v && (kept.v !== 'Planning Ready' || gate) ? kept.v : defaultVerdict(x);
  const reading = readingOf(s.evidence_id), against = gate && reading && reading.title !== RESULTS_POSITIVE;
  const radio = v => `${verdict === v ? 'checked' : ''}${v === 'Planning Ready' && !gate ? ' disabled' : ''}`;
  return `<div class="grid2"><section class="panel pad stack"><h2>Gate for Planning Ready</h2><ul style="list-style:none;padding:0;margin:0">${items.map(([t, ok]) => `<li class="row" style="padding:4px 0">${ok ? pill('pass', 'Done') : pill('unknown', 'Missing')} ${t}</li>`).join('')}</ul>
    <p class="small muted">There is no "ship" option in this product. The decision form starts as a system draft: rewrite it in your own words; the record notes whether you did.</p></section>
    <form class="panel pad stack" data-form="decision" data-id="${x.experiment_id}" data-evidence="${esc(s.evidence_id ?? '')}"><h2>Record decision</h2><fieldset><legend class="small muted">Verdict</legend>
      <label class="choice"><input type="radio" name="v" value="Planning Ready" ${radio('Planning Ready')}><span><b>Planning Ready</b><br><span class="small muted">${gate ? 'Prepare an independent real experiment' : 'Locked until every gate item is done'}</span></span></label>
      <label class="choice"><input type="radio" name="v" value="Need More Evidence" ${radio('Need More Evidence')}><span><b>Need more evidence</b></span></label><label class="choice"><input type="radio" name="v" value="Stop / Blocked" ${radio('Stop / Blocked')}><span><b>Stop</b></span></label></fieldset>
      ${against ? `<label class="field">Only if you choose Planning Ready: why prepare a real test although the results say “${esc(reading.title)}”?<textarea name="override" rows="3">${esc(kept?.override ?? '')}</textarea><span class="small muted">Required for Planning Ready here. The record will say it overrides the results recommendation.</span></label>` : ''}
      <label class="field">Why<textarea name="rationale" rows="4" required>${esc(val('rationale'))}</textarea></label>
      <label class="field">Alternatives considered<textarea name="alternatives" rows="4" required>${esc(val('alternatives'))}</textarea></label>
      <label class="field">Still assumptions<textarea name="assumptions" rows="4" required>${esc(val('assumptions'))}</textarea></label>
      <label class="field">What would change my mind<textarea name="changeMyMind" rows="4" required>${esc(val('changeMyMind'))}</textarea></label>
      <label class="field">Next step<textarea name="next" rows="4" required>${esc(kept?.next ?? (d.nextBy[verdict] || d.next))}</textarea></label>
      ${s.evidence_id ? '' : '<p class="small muted" data-no-evidence>Import the results first: every decision is bound to checked evidence.</p>'}
      <button class="btn primary" type="submit" ${s.evidence_id ? '' : 'disabled'}>Record decision</button></form></div>`;
}
