                                                                         
import { DIMS, METRICS, TYPE_LABEL, actionability, breakdown, compare, dailySeries, dataRange, optionsFor, totals } from '../../engine/analytics.mjs';
import { activity, decisions, experiments, opportunities, opportunityFor, segLabel } from '../../store/store.mjs';
import { db, decidedVoid, getDiag, head, shell } from '../app.mjs';
import { lineChart, rateSeries } from '../charts.mjs';
import { dayLabel, esc, fold, gbp, icon, narrow, num, pct, pp, rate } from '../format.mjs';
import { nextOf } from './experiment.mjs';

                     
export function overview() {
  if (!db) return shell('', `<div class="hero-empty"><h1>Understand payment friction. Make evidence-based decisions.</h1>
    <p class="lede">Explore the product, or follow a five-minute walkthrough of one checkout improvement case.</p>
    <ol class="loop" aria-label="How a checkout case moves through the product"><li><b>Monitor</b>Watch checkout rates over time</li><li><b>Find</b>See where a change is concentrated, and at which stage</li><li><b>Size</b>Estimate options from the data, with assumptions you can edit</li><li><b>Test</b>Seal a plan before any result, then read the A/B result</li><li><b>Decide</b>Check guardrails, then decide whether to prepare a real experiment</li></ol>
    <div class="row hero-actions"><button class="btn primary" data-act="load-sample">Load sample data</button><a class="link-action" href="#/tour">Take the 5-minute tour ${icon('chev')}</a></div>
    <p class="small muted" style="margin-top:12px">The sample is 90 days of synthetic checkout history for a UK online shop. Nothing leaves your browser.</p></div>`);
                                                                                                                          
  const d = getDiag(), w = d.window, r = dataRange(db), cur = totals(db, {}, ...w.cur), base = totals(db, {}, ...w.base);
  const opps = opportunities(db), exps = experiments(db), decs = decisions(db), acts = activity(db, 4);
  const rel = (c, b) => (b ? `${c >= b ? '+' : '−'}${Math.abs((c / b - 1) * 100).toFixed(1)}%` : '—');
  const rateCell = (label, mk) => { const m = METRICS[mk], t = compare(base[m.num], base[m.den], cur[m.num], cur[m.den]), cls = t && t.p < 0.05 ? (t.diff > 0 ? 'up' : 'down') : 'flat';
    return `<div class="kpi"><span class="kpi-l">${label}</span><b class="kpi-v">${pct(cur[m.num], cur[m.den])}</b><span class="small ${cls}">${t ? pp(t.diff, 1) : '—'}</span></div>`; };
  const kpis = `<section class="panel kpis" aria-label="Last 28 days compared with the 28 days before">
    <div class="kpi"><span class="kpi-l">Checkouts started</span><b class="kpi-v">${num(cur.started)}</b><span class="small flat">${rel(cur.started, base.started)}</span></div>
    ${rateCell('Payment submission', 'submission')}${rateCell('Authorisation conversion', 'auth')}${rateCell('Issuer approval', 'approval')}
    <div class="kpi"><span class="kpi-l">Approved value</span><b class="kpi-v">${gbp(cur.approved_amount)}</b><span class="small flat">${rel(cur.approved_amount, base.approved_amount)}</span></div></section>`;

  const lead = d.findings.find(f => f.kind === 'change' && f.metric === 'submission') ?? d.findings.find(f => f.kind === 'change');
  const dim = lead?.segment?.dim ?? 'channel', mk = lead?.metric ?? 'submission', M = METRICS[mk], hot = lead?.segment?.value;
  const daily = dailySeries(db, {}, r.first, r.last, dim), keys = [...new Set(daily.map(x => x.k))], calm = ['var(--s2)', 'var(--s3)', 'var(--s5)', 'var(--s4)'];
  const series = keys.map((k, i) => ({ label: DIMS[dim].values[k] ?? k, color: k === hot ? 'var(--s1)' : calm[i % 4], width: k === hot ? 2.75 : 1.5, points: rateSeries(daily.filter(x => x.k === k), mk, true) }));
  const others = lead ? breakdown(db, {}, dim, w.cur, w.base).filter(b => b.key !== hot && b.base).map(b => { const t = compare(b.base[M.num], b.base[M.den], b.cur[M.num], b.cur[M.den]); return `${DIMS[dim].values[b.key] ?? b.key} ${t ? pp(t.diff, 1) : '—'}`; }) : [];
  const trend = `<section class="panel pad stack"><div class="row"><h2>${M.label} by ${DIMS[dim].label.toLowerCase()}, 90 days</h2><span class="spacer"></span>${lead ? `<a class="small" href="#/findings/${lead.id}">Open ${lead.id}</a>` : ''}</div>
    ${lineChart({ series, height: 230, shade: w.cur, markers: lead?.onset ? [{ day: lead.onset, label: 'Change around ' + dayLabel(lead.onset) }] : [], label: `${M.label} by ${DIMS[dim].label}, 7-day rolling` })}
    <p class="small">${lead ? `<b>${esc(segLabel(lead.segment))}</b> went from ${rate(lead.test.p1)} to ${rate(lead.test.p2)} between the previous 28 days and the last 28 (shaded)${lead.onset ? `, starting around ${dayLabel(lead.onset)}` : ''}. Same period: ${esc(others.join(', '))}.` : 'No significant change in the last 28 days.'} <span class="muted">7-day rolling.</span></p></section>`;

  const steps = [['Checkouts started', 'started'], ['Submitted a payment', 'submitted'], ['Reached the bank', 'reached'], ['Approved', 'approved']];
  const drops = ['left before pressing Pay', 'stopped before the bank, for example at 3-D Secure', 'declined or errored'];
  const funnel = `<section class="panel pad stack"><h2>Where checkouts are lost</h2><div class="ofunnel">${steps.map(([l, k], i) => `${i ? `<p class="of-drop">${icon('down')}<span><b>${num(cur[steps[i - 1][1]] - cur[k])}</b> ${drops[i - 1]}</span></p>` : ''}
    <div class="of-step"><div class="row"><b>${l}</b><span class="spacer"></span><span class="small">${pct(cur[k], cur.started)}</span></div><div class="of-bar"><span style="width:${(cur[k] / cur.started * 100).toFixed(1)}%"></span>${i ? `<i style="left:${(base[k] / base.started * 100).toFixed(1)}%" title="Previous 28 days: ${pct(base[k], base.started)}"></i>` : ''}</div></div>`).join('')}</div>
    <p class="small muted">Last 28 days, share of checkouts started. The tick marks the previous 28 days.</p></section>`;

  const maxLost = Math.max(1, ...d.findings.map(f => f.lostPerWeek));
  const problems = `<section class="panel pad stack"><div class="row"><h2>Problems found</h2><span class="spacer"></span><a class="small" href="#/findings">All ${d.findings.length} findings</a></div>
    ${d.findings.length ? `<div class="pbars">${d.findings.map(f => `<a class="pbar" href="#/findings/${f.id}"><span class="pbar-l"><span class="mono">${f.id}</span> <b>${esc(TYPE_LABEL[f.type])}</b> <span class="muted">· ${esc(segLabel(f.segment))}</span><span class="pbar-u">${esc(f.unit)}</span></span>
      <span class="pbar-t"><span style="width:${(f.lostPerWeek / maxLost * 100).toFixed(1)}%"></span></span><span class="pbar-v"><b>≈ ${num(f.lostPerWeek)}</b> <span class="muted">a week</span></span></a>`).join('')}</div>
      <p class="small muted">Bar length is the weekly count. Units differ between problems, so read the label with the bar.</p>` : '<p class="muted">No significant problems in the current window.</p>'}</section>`;

                                                                                                    
  const openExp = exps.find(x => x.state.stage !== 'Decided' || decidedVoid(x));
  const testO = opps.find(o => canTestNow(o.finding) && !exps.some(x => x.opportunity_id === o.opportunity_id)), testF = d.findings.find(f => canTestNow(f) && !opportunityFor(db, f));                                                      
  const nextAct = openExp ? [`${nextOf(openExp)[0]} · ${openExp.experiment_id}`, `#/experiments/${openExp.experiment_id}/${nextOf(openExp)[1]}`]
    : testO ? [`Design an experiment for ${testO.opportunity_id}`, `#/opportunities/${testO.opportunity_id}`] : testF ? [`Open ${testF.id} as an opportunity`, `#/findings/${testF.id}`]
    : decs.length ? ['Review decisions', '#/decisions'] : d.findings.length ? [`Investigate ${d.findings[0].id}`, `#/findings/${d.findings[0].id}`] : null;
  const stages = [['Findings', d.findings.length, '#/findings'], ['Opportunities', opps.length, '#/opportunities'], ['Experiments', exps.length, '#/experiments'], ['Decisions', decs.length, '#/decisions']];
  const progress = `<section class="panel pad stack"><h2>From problem to decision</h2><ol class="pipe">${stages.map(([l, n, h]) => `<li class="${n ? 'has' : ''}"><a href="${h}"><b>${n}</b><span>${l}</span></a></li>`).join('')}</ol>
    ${nextAct ? `<a class="btn primary" style="align-self:flex-start" href="${nextAct[1]}">Next: ${esc(nextAct[0])} ${icon('chev')}</a>` : ''}
    ${acts.length ? `<ul class="acts small">${acts.map(a => `<li><span>${esc(a.action)}</span> <span class="mono">${esc(a.object_id)}</span></li>`).join('')}</ul>` : `<p class="small muted">Nothing recorded yet. Data covers ${r.days} days.</p>`}</section>`;

                                                                                                                            
                                                                                        
  const top = d.findings[0], small = narrow();
  const leadCard = small && top ? `<section class="panel pad stack ov-lead section"><h2>Biggest problem now</h2>
    <p><a href="#/findings/${top.id}"><span class="mono">${top.id}</span> <b>${esc(TYPE_LABEL[top.type])}</b></a> · ${esc(segLabel(top.segment))}</p>
    <p><b>≈ ${num(top.lostPerWeek)}</b> ${esc(top.unit)} a week</p>
    ${nextAct ? `<a class="btn primary" style="align-self:flex-start" href="${nextAct[1]}">Next: ${esc(nextAct[0])} ${icon('chev')}</a>` : ''}</section>` : '';
  return shell('', `${head('Overview', '<a class="link-action" href="#/tour">Take the 5-minute tour ' + icon('chev') + '</a>')}
    <p class="small muted ov-period">Last 28 days, ${dayLabel(w.cur[0])} – ${dayLabel(w.cur[1])}, against the 28 days before. Colour marks a significant change (p &lt; 0.05).</p>
    ${leadCard}${kpis}${small ? `<div class="section">${fold('Trend and funnel', trend + funnel)}</div>` : `<div class="ov-main section">${trend}${funnel}</div>`}<div class="grid2 section">${problems}${progress}</div>`);
}
export const canTestNow = f => optionsFor(f).some(r => actionability(r) === 'Can test now');
