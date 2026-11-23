                                                                              
import { METRICS, TYPE_LABEL, actionability, estimate, optionsFor } from '../../engine/analytics.mjs';
import { dataVersion, experiments, findingKey, opportunities, sameObservation, segLabel } from '../../store/store.mjs';
import { db, getDiag, head, needData, notFound, shell, ui } from '../app.mjs';
import { dayLabel, esc, gbp, icon, num, observedWhy, pill, pp } from '../format.mjs';
import { windowLabel } from './findings.mjs';
import { canTestNow } from './overview.mjs';

                          
export function opportunitiesPage() {
  if (!db) return needData('opportunities');
  const list = opportunities(db);
  return shell('opportunities', `${head('Opportunities')}${list.length ? `<section class="panel"><div class="table-scroll"><table class="data"><thead><tr><th>ID</th><th>Opportunity</th><th>Problem type</th><th class="num">Lost / week at opening</th><th>Status</th></tr></thead><tbody>
    ${list.map(o => `<tr class="link" data-href="#/opportunities/${o.opportunity_id}"><td class="mono">${o.opportunity_id}</td><td><a href="#/opportunities/${o.opportunity_id}"><b>${esc(o.title)}</b></a></td><td>${esc(TYPE_LABEL[o.finding.type])}</td><td class="num">≈ ${num(o.finding.lostPerWeek)}</td><td>${o.status === 'In experiment' ? pill('warn', o.status) : pill('unknown', o.status)}</td></tr>`).join('')}</tbody></table></div></section>`
    : `<div class="panel empty"><h2>No opportunities yet</h2><p>Opportunities start from findings. Open one from the Findings page to size the options.</p><a class="btn primary" href="#/findings">Go to Findings</a></div>`}`);
}
export function opportunityDetail(id) {
  if (!db) return needData('opportunities');
  const o = opportunities(db).find(x => x.opportunity_id === id);
  if (!o) return notFound('opportunities');
  const f = o.finding, w = f.window ?? ui.diagWin, exps = experiments(db).filter(x => x.opportunity_id === id);
                                                                                                                         
  const check = f.kind === 'check', current = !check && sameObservation(f, getDiag().window, dataVersion(db)) ? getDiag().findings.find(x => findingKey(x) === f.key) : null;
                                                                              
  const opts = optionsFor(f).map(r => { const a = ui.assumptions[`${id}|${r.id}`] ?? {}; return { r, a, e: estimate(db, f, r, w, a) }; }).sort((x, y) => (y.e.valueMid ?? -1) - (x.e.valueMid ?? -1));
  const kind = r => { const k = actionability(r); return pill(k === 'Can test now' ? 'pass' : k === 'Investigate only' ? 'unknown' : 'warn', k); };
  return shell('opportunities', `<div class="context"><a href="#/opportunities">Opportunities</a>${icon('chev')}<span class="mono">${id}</span>${icon('chev')}${current ? `<a href="#/findings/${current.id}">${current.id}</a>` : check ? `<span>Check of ${esc(dayLabel(f.date))}</span>` : `<span class="mono">${esc(f.id)}</span><span class="small muted">&nbsp;(earlier analysis)</span>`}</div>${head(esc(o.title))}
    <p class="callout warn section" style="margin-top:0"><b>${esc(TYPE_LABEL[f.type])} · about ${num(f.lostPerWeek)} ${esc(f.unit ?? 'checkouts lost (estimated)')} a week</b>${esc(observedWhy(f.why))}</p>
    ${check ? `<p class="small muted section">Observation behind ${id}: a specific-change check of ${esc(dayLabel(f.date))}, ${esc(METRICS[f.metric].label.toLowerCase())} on ${esc(segLabel(f.segment).toLowerCase())}, comparing ${esc(windowLabel(w))} (${f.days} days each side), data ${esc(f.dataVersion ?? 'version not recorded')}. It compares two periods and does not show what caused the difference; the options below are ideas to investigate or test.</p>`
      : `<p class="small muted section">Observation behind ${id}: ${esc(f.id)} in the analysis of ${esc(windowLabel(w))}, data ${esc(f.dataVersion ?? 'version not recorded (opened before this was kept)')}.${current ? '' : ' The Findings page now analyses a different window; this opportunity keeps the numbers of its own observation.'}</p>`}
    ${canTestNow(f) ? '' : '<p class="callout warn section"><b>Investigation only</b>None of these options can be tested in this product. Requesting TRA exemptions depends on whether payments qualify, which the PSP and compliance decide; use the options and estimates to plan the investigation.</p>'}
    <section class="panel section"><div class="pad row"><h2>Options, sized from your data</h2><span class="spacer"></span><span class="badge">Estimates · editable assumptions</span></div>
    <div class="table-scroll"><table class="data"><thead><tr><th>Option</th><th>Assumed recovery</th><th class="num">Checkouts / week</th><th class="num">Est. approved value / week</th><th class="num">Test size</th><th>Effort</th><th></th></tr></thead><tbody>
    ${opts.map(({ r, e }) => { const ex = exps.find(x => x.rule_id === r.id); return `<tr><td><b>${esc(r.title)}</b> ${kind(r)}<div class="small muted">${esc(r.how)}</div>
        <details class="small"><summary>When it applies</summary><dl class="kv small" style="grid-template-columns:110px 1fr;margin-top:6px"><dt>Use when</dt><dd>${esc(r.when)}</dd><dt>Needs</dt><dd>${esc(r.needs)}</dd><dt>Controlled by</dt><dd>${esc(r.owner)}</dd><dt>Main risk</dt><dd>${esc(r.risk)}</dd><dt>Not for</dt><dd>${esc(r.notFor)}</dd><dt>Primary metric</dt><dd>${r.metric ? METRICS[r.metric].label : '—'}</dd></dl></details></td>
      <td>${e.estimable ? `<div class="row" style="gap:4px;flex-wrap:nowrap"><input class="pct" type="number" min="0" max="100" step="5" value="${Math.round(e.recover[0] * 100)}" data-assume="${id}|${r.id}|0" aria-label="Low assumption %">–<input class="pct" type="number" min="0" max="100" step="5" value="${Math.round(e.recover[1] * 100)}" data-assume="${id}|${r.id}|1" aria-label="High assumption %">%</div><div class="small muted">of ${num(e.lostBase)} a week = ${pp(e.upliftPP[0] / 100, 1)} to ${pp(e.upliftPP[1] / 100, 1)} on ${esc(segLabel(f.segment).toLowerCase())}</div>` : `<span class="muted small">${esc(e.reason)}</span>`}</td>
      <td class="num">${e.estimable ? `${num(e.recovered[0])}–${num(e.recovered[1])}` : '—'}</td><td class="num">${e.estimable ? `${gbp(e.valuePerWeek[0])}–${gbp(e.valuePerWeek[1])}<div class="small muted">mid ${gbp(e.valueMid)}</div>` : '—'}</td>
      <td class="num">${e.perArm ? `${num(e.perArm)} per group<div class="small ${e.testDays > 90 ? 'down' : 'muted'}">${e.testDays > 90 ? `${num(e.testDays)} days: too slow at current traffic` : `≈ ${e.testDays} days at MDE ${e.mde} pp`}</div>` : '—'}</td><td>${r.effort}</td>
      <td>${ex ? `<a class="btn small" href="#/experiments/${ex.experiment_id}/plan">${ex.experiment_id}</a>` : actionability(r) === 'Can test now' ? `<button class="btn small primary" data-act="new-exp" data-opp="${id}" data-rule="${r.id}">Design experiment</button>` : ''}</td></tr>`; }).join('')}</tbody></table></div>
    <p class="small muted pad">Assumptions are illustrative: edit them for your business. Est. approved value = extra submissions × share reaching the issuer × issuer approval × average approved order in this segment; it assumes new payments behave like past ones and is not revenue or profit. Sorted by the middle of the estimate. Test size uses α 0.05, power 0.80 and an MDE at the middle of the assumed range.</p></section>`);
}
