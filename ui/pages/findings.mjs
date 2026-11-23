                                                                         
import { DIAG, METRICS, TYPE_LABEL, actionability, addDays, dailySeries, dataRange, declineMix, optionsFor, segFilter, totals } from '../../engine/analytics.mjs';
import { dataVersion, opportunities, opportunityFor, sameObservation, segLabel } from '../../store/store.mjs';
import { db, getDiag, head, needData, notFound, shell, tour, ui } from '../app.mjs';
import { lineChart, rateSeries } from '../charts.mjs';
import { dayLabel, esc, icon, num, observedWhy, pct, pp, pval, rate } from '../format.mjs';

                                                             
export const windowLabel = w => (w?.cur && w?.base ? `${dayLabel(w.cur[0])} – ${dayLabel(w.cur[1])} against ${dayLabel(w.base[0])} – ${dayLabel(w.base[1])}` : 'a window that was not recorded');
export const findingChange = f => (f.kind === 'structural' ? `${(f.share * 100).toFixed(1)}% ${f.type === 'RETRY_GAP' ? 'never retried' : 'not completed'}` : `${METRICS[f.metric].label} ${pp(f.test.diff, 1)}`);

                     
export function findings() {
  if (!db) return needData('findings');
                                                                                                                 
  const d = getDiag(), w = ui.diagWin, opps = opportunities(db), oppFor = f => { const id = opportunityFor(db, f); return id && opps.find(o => o.opportunity_id === id); }, ver = dataVersion(db);
  return shell('findings', `${head('Findings', `<a class="btn small" href="#/findings/check">Check a specific change</a>`)}
    <section class="panel controls" aria-label="Diagnosis window"><label class="field">Current from<input type="date" data-bind="diag.cur0" value="${w.cur[0]}"></label><label class="field">to<input type="date" data-bind="diag.cur1" value="${w.cur[1]}"></label>
      <label class="field">Baseline from<input type="date" data-bind="diag.base0" value="${w.base[0]}"></label><label class="field">to<input type="date" data-bind="diag.base1" value="${w.base[1]}"></label>
      <button class="btn small" data-act="diag-default">Last 28 days vs previous 28</button>
      <p class="small muted" style="flex-basis:100%">${d.tested} segment tests across submission, issuer approval and 3-D Secure completion, Holm-adjusted. A finding needs adjusted p &lt; ${DIAG.alpha}, a drop of at least ${DIAG.minDropPP} pp and ${DIAG.minDenominator}+ in the denominator. Structural checks look for retry gaps and challenge drop-off. Calibrated on synthetic data: expect about 1 false finding in 25 reviews; drops under 2 pp in segments with fewer than about 400 checkouts a day are usually missed in a 28-day window.</p></section>
    <section class="panel section">${d.findings.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>ID</th><th>Problem</th><th>Segment</th><th>Signal</th><th class="num">Evidence</th><th>Started</th><th class="num">Affected / week</th><th></th></tr></thead><tbody>
      ${d.findings.map(f => { const o = oppFor(f); return `<tr class="link${tour && tour.f.id === f.id ? ' hl' : ''}" data-href="#/findings/${f.id}"><td class="mono">${f.id}</td><td><a href="#/findings/${f.id}"><b>${esc(TYPE_LABEL[f.type])}</b></a>${f.explains?.length ? `<details class="small muted explains"><summary>Grouped with ${f.explains.length} related segment finding${f.explains.length > 1 ? 's' : ''}</summary><p class="small">Grouped because each one's drop no longer stands out once this segment is left out. Grouping shows how the findings overlap, not what caused them.</p><ul>${f.explains.map(s => `<li>${esc(s)}</li>`).join('')}</ul></details>` : ''}</td>
        <td>${esc(segLabel(f.segment))}</td><td>${esc(findingChange(f))}</td><td class="num muted">${f.kind === 'change' ? 'p<sub>adj</sub> ' + pval(f.pAdj) : 'structural'}</td><td>${f.onset ? 'around ' + dayLabel(f.onset) : '—'}</td><td class="num"><b>≈ ${num(f.lostPerWeek)}</b><div class="small muted">${esc(f.unit)}</div></td>
        <td>${o ? `<a class="btn small" href="#/opportunities/${o.opportunity_id}">${o.opportunity_id}</a>${sameObservation(o.finding, d.window, ver) ? '' : `<div class="small muted" title="${esc(o.opportunity_id)} keeps the numbers of the ${o.finding.kind === 'check' ? 'check' : 'analysis'} it was opened from">${o.finding.kind === 'check' ? 'from a check' : 'earlier analysis'}</div>`}` : `<button class="btn small" data-act="open-opp" data-id="${f.id}">Open opportunity</button>`}</td></tr>`; }).join('')}</tbody></table></div>`
      : '<div class="empty"><h2>No significant problems in this window</h2><p>Nothing passed the thresholds. Try a longer window, or compare against an earlier baseline.</p></div>'}</section>`);
}
export function findingDetail(id) {
  if (!db) return needData('findings');
  const d = getDiag(), f = d.findings.find(x => x.id === id);
  if (!f) return notFound('findings');
  const w = d.window, seg = segFilter(f.segment), metric = f.kind === 'structural' ? (f.type === 'RETRY_GAP' ? 'auth' : 'challenge') : f.metric;
  const daily = dailySeries(db, seg, addDays(w.base[0], -6) < dataRange(db).first ? dataRange(db).first : addDays(w.base[0], -6), w.cur[1]);
  const series = [{ label: segLabel(f.segment), color: 'var(--s1)', points: rateSeries(daily, metric, true) }];
  const B = totals(db, seg, ...w.base), C = totals(db, seg, ...w.cur);
  const steps = [['Started', 'started'], ['Submitted', 'submitted'], ['Reached the bank', 'reached'], ['Approved', 'approved']];
  const mixB = declineMix(db, seg, ...w.base), mixC = declineMix(db, seg, ...w.cur), tb = mixB.reduce((a, r) => a + r.n, 0), tc = mixC.reduce((a, r) => a + r.n, 0);
  const reasons = [...new Set([...mixB, ...mixC].map(r => r.reason))];
  const oid = opportunityFor(db, f), o = oid && opportunities(db).find(x => x.opportunity_id === oid), earlier = o && !sameObservation(o.finding, getDiag().window, dataVersion(db));
  const list = items => `<ul class="small" style="margin:6px 0 0;padding-left:18px">${(items ?? []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  return shell('findings', `<div class="context"><a href="#/findings">Findings</a>${icon('chev')}<span class="mono">${f.id}</span></div>${head(esc(TYPE_LABEL[f.type]) + ' · ' + esc(segLabel(f.segment)))}
    <div class="main-side"><div class="stack"><div class="callout warn"><b>Observed: ${esc(findingChange(f))} · about ${num(f.lostPerWeek)} ${esc(f.unit)} a week</b>${esc(observedWhy(f.why))}</div>
      <section class="panel pad grid2" id="causes"><div><h2 class="h3">Possible causes, not yet confirmed</h2>${list(f.candidates)}</div><div><h2 class="h3">Evidence to check first</h2>${list(f.missing)}<p class="small muted" style="margin-top:6px">This product does not hold these yet.</p></div></section>
      <section class="panel pad"><h2>${METRICS[metric].label}, 7-day rolling</h2>${lineChart({ series, shade: w.cur, markers: f.onset ? [{ day: f.onset, label: 'Change around ' + dayLabel(f.onset) }] : [], label: 'Trend for this finding' })}
        <p class="small muted">Shaded: current window ${dayLabel(w.cur[0])} – ${dayLabel(w.cur[1])}. Baseline ${dayLabel(w.base[0])} – ${dayLabel(w.base[1])}. A change near a date is not proof of what caused it.</p></section>
      <section class="panel pad stack"><h2>Where the loss happens</h2><div class="funnel"><span></span><b class="small">Baseline</b><b class="small">Current</b>
        ${steps.map(([l, k]) => `<span>${l}</span>${[B, C].map((x, i) => `<div><div class="bar ${i ? 'b' : ''}"><span style="width:${(x[k] / x.started * 100).toFixed(1)}%"></span></div><span class="small muted">${pct(x[k], x.started)} · ${num(x[k])}</span></div>`).join('')}`).join('')}
        <span class="small"><b>Approval once reached</b></span><b>${pct(B.approved, B.reached)}</b><b>${pct(C.approved, C.reached)}</b></div></section>
      ${tb && tc ? `<section class="panel"><div class="pad"><h2>Decline reasons</h2></div><div class="table-scroll"><table class="data"><thead><tr><th>Reason</th><th class="num">Baseline share</th><th class="num">Current share</th><th class="num">Change</th></tr></thead><tbody>
        ${reasons.map(rs => { const b = (mixB.find(x => x.reason === rs)?.n ?? 0) / tb, c = (mixC.find(x => x.reason === rs)?.n ?? 0) / tc; return `<tr><td>${esc(rs.replace(/_/g, ' '))}</td><td class="num">${rate(b)}</td><td class="num">${rate(c)}</td><td class="num ${c - b > 0.03 ? 'down' : 'flat'}">${pp(c - b, 1)}</td></tr>`; }).join('')}</tbody></table></div></section>` : ''}</div>
    <aside class="stack"><section class="panel pad stack"><h2>Evidence</h2><dl class="kv small" style="grid-template-columns:1fr auto">${f.kind === 'change' ? `<dt>Baseline</dt><dd class="right">${rate(f.test.p1)} (${num(f.base[METRICS[f.metric].den])})</dd><dt>Current</dt><dd class="right">${rate(f.test.p2)} (${num(f.cur[METRICS[f.metric].den])})</dd>
      <dt>Change</dt><dd class="right">${pp(f.test.diff)}</dd><dt>95% CI</dt><dd class="right">${pp(f.test.ci[0], 1)} to ${pp(f.test.ci[1], 1)}</dd><dt>Adjusted p</dt><dd class="right">${pval(f.pAdj)}</dd>` : `<dt>Share</dt><dd class="right">${rate(f.share)}</dd>`}</dl>
      ${f.explains?.length ? `<p class="small muted">This also explains the drop in: ${esc(f.explains.join(', '))}. Excluding ${esc(segLabel(f.segment).toLowerCase())}, those segments show no significant change.</p>` : ''}</section>
      <section class="panel pad stack"><h2>Options to consider</h2><ul class="small" style="margin:0;padding-left:18px">${optionsFor(f).map(r => `<li>${esc(r.title)} <span class="muted">· ${actionability(r)}</span></li>`).join('') || '<li>No playbook option; investigate manually.</li>'}</ul>
      ${earlier && o.finding.kind === 'check' ? `<p class="callout warn small" style="margin:0"><b>Already open as ${o.opportunity_id}, from a specific-change check</b>${o.opportunity_id} was opened from a check of ${esc(dayLabel(o.finding.date))} (${esc(windowLabel(o.finding.window))}). The numbers on this page come from ${esc(windowLabel(getDiag().window))}: a separate observation, not part of ${o.opportunity_id}'s evidence.</p>` : ''}
      ${earlier && o.finding.kind !== 'check' ? `<p class="callout warn small" style="margin:0"><b>Already open as ${o.opportunity_id}, from an earlier analysis</b>${o.opportunity_id} was opened from the analysis of ${esc(windowLabel(o.finding.window))}. The numbers on this page come from ${esc(windowLabel(getDiag().window))}: a separate observation, not part of ${o.opportunity_id}'s evidence.</p>` : ''}
      ${o ? `<a class="btn primary" href="#/opportunities/${o.opportunity_id}">Go to ${o.opportunity_id} ${icon('chev')}</a>` : `<button class="btn primary" data-act="open-opp" data-id="${f.id}">Open as opportunity ${icon('chev')}</button>`}</section></aside></div>`);
}
