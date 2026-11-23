                                                                                       
import { DIMS, METRICS, breakdown, compare, daysBetween, optionsFor, segFilter, totals } from '../../engine/analytics.mjs';
import { analyse } from '../../engine/results.mjs';
import { experimentState } from '../../store/db.mjs';
import { evidenceFor, experiments, segLabel } from '../../store/store.mjs';
import { currentPlan, db, head, integrityOf, shell, tour } from '../app.mjs';
import { intervalChart } from '../charts.mjs';
import { dayLabel, esc, fold, gbp, icon, num, pill, pp, pval, rate } from '../format.mjs';
import { defaultVerdict, verdictFor } from './experiment.mjs';

                        
                                                                                                                                                  
export const TOUR = [['Payment performance', 'The checkout over 90 days, and the one line that is not steady.'], ['Find the problem', 'What was observed: a drop concentrated in one segment, and the checkout stage it points to.'],
  ['Diagnose, without over-claiming', 'Candidate causes and the evidence still missing: a hypothesis, not a fact.'], ['Choose an option and plan the test', 'Options sized from the data; a plan sealed before any result.'],
  ['The simulated A/B result', 'What A and B looked like, the checks, the simulated number and the suggested next steps.'], ['When the result is not a win', 'A synthetic comparison: the same plan with other simulated outcomes, and how the conclusion changes.'],
  ['Risk and decision', 'Guardrails, what is still assumed, what would change the decision: Planning Ready, not a rollout.']];
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];
const pct = v => (v * 100).toFixed(1) + '%';
                                                                                                                                             
function approvalChange() {
  const { d, f } = tour, t = [totals(db, segFilter(f.segment), ...d.window.base), totals(db, segFilter(f.segment), ...d.window.cur)];
  return compare(t[0].approved, t[0].reached, t[1].approved, t[1].reached);
}
                                                                                                   
                                                                                                                   
export function tourLive() {
  const st = experimentState(db, tour.expId), plan = currentPlan(tour.expId), stored = st.evidence_id ? evidenceFor(db, st.evidence_id) : null;
  if (tour.cache?.key !== (st.evidence_id ?? '-')) { const x = experiments(db).find(e => e.experiment_id === tour.expId); tour.cache = { key: st.evidence_id ?? '-', an: stored ? analyse(stored.rows, stored.evidence, x.guardrails) : null }; }
  return { st, plan, ev: stored?.evidence ?? null, an: tour.cache.an };
}
export function tourText(n) {
  const { d, f, rule, est, effect, oppId, expId } = tour, { st, plan, ev, an } = tourLive(), s = an?.checked ? ev.statistics : null, M = METRICS[f.metric], seg = segLabel(f.segment);
  const fails = an ? an.guardrails.filter(g => g.verdict === 'Fail').map(g => g.label.toLowerCase()) : [];
  const missing = [[st.evidence_status === 'Synthetic Evidence Checked', 'checked evidence'], [st.design_outcome === 'Pass', 'a passed design review'], [st.evidence_outcome === 'Pass', 'a passed evidence review']].filter(([ok]) => !ok).map(([, t]) => t);
  const others = breakdown(db, {}, f.segment.dim, d.window.cur, d.window.base).filter(b => b.key !== f.segment.value && b.base).map(b => { const t = compare(b.base[M.num], b.base[M.den], b.cur[M.num], b.cur[M.den]); return `${DIMS[f.segment.dim].values[b.key] ?? b.key} ${t ? pp(t.diff, 1) : '—'}`; });
  const carried = an ? an.guardrails.filter(g => g.carry) : [], opts = optionsFor(f).length, ap = n === 3 ? approvalChange() : null, others6 = WORDS[tour.scenarios.length - 1] ?? 'other';
  return [
                                                                                                   
    { look: `Read the orange line: ${esc(seg)} ${M.label.toLowerCase()} drops around ${dayLabel(f.onset)} (dashed line). The page compares the last ${daysBetween(d.window.cur[0], d.window.cur[1])} days with the ${daysBetween(d.window.base[0], d.window.base[1])} before. In the breakdown, ${esc(seg.toLowerCase())} is at ${rate(f.test.p2)}, ${pp(f.test.diff, 1)}; over the same weeks: ${esc(others.join(', '))}.`,
      fact: `${seg} ${M.label.toLowerCase()} ${pp(f.test.diff, 1)} to ${rate(f.test.p2)} from about ${dayLabel(f.onset)}` },
    { look: `The product made ${d.tested} comparisons across groups of checkouts and adjusted for how many it made, because some differences appear by chance when many are compared. The highlighted row, <b>${f.id}</b>, is this drop: ${pp(f.test.diff, 1)} on ${esc(seg.toLowerCase())}; it still stands out after that adjustment (adjusted p ${pval(f.pAdj)}). ${f.explains?.length ?? 0} other findings that include ${esc(seg.toLowerCase())} checkouts are grouped into this row: once ${esc(seg.toLowerCase())} checkouts are taken out of them, their drop no longer stands out. Open <i>Grouped with ${f.explains?.length ?? 0} related segment findings</i> on the row to see them. A drop in a segment is an observation; it does not say why.`,
      fact: `${f.id} (loss before Pay): about ${num(f.lostPerWeek)} checkouts a week, an estimate` },
    { look: `Submission fell. ${ap ? `Of the payments in this segment that reached the card issuers, they approved ${pct(ap.p1)} before and ${pct(ap.p2)} after.` : 'Issuer approval in the same segment could not be compared.'} That suggests looking first at the steps before shoppers press Pay; the cause is not yet confirmed. The page lists possible causes and the evidence still missing; a form or page change around the start of the drop is one candidate.`,
      fact: 'Cause not yet confirmed; look first at the steps before Pay' },
    { look: `${opts} options are sized from this segment's own numbers, with assumptions you can edit. The tour tests <b>${esc(rule.title)}</b> (about ${gbp(est.valueMid)} a week at the middle of its assumptions). Its plan was sealed before any result: ${num(plan.requiredPerArm)} checkouts per group, sized to detect a true improvement of ${plan.mdePP} pp: the smallest improvement this test is planned to detect, not the least benefit worth having. <a href="#/experiments/${expId}/plan">See the sealed plan</a>.`,
      fact: `Testing “${rule.title}”; plan sealed at ${num(plan.requiredPerArm)} per group` },
    !s ? { look: 'There is no checked result for the current plan yet. The page shows what is missing; every rate stays hidden until the checks pass.', fact: 'No checked result for the current plan yet' }
      : { look: `The checks come first, then the number. In this simulated result, B is ${pp(s.difference)} on payment submission (95% CI ${pp(s.ci95[0])} to ${pp(s.ci95[1])}).${fails.length ? ` But ${esc(fails.join(' and '))} failed beyond its tolerance, so Planning Ready is blocked.` : ''} Scroll for what A and B looked like and the suggested next steps. Synthetic: the true effect was set to +${effect} pp, so this shows how the checks work, not how shoppers behave.`,
        fact: `Simulated result: B ${pp(s.difference)}${fails.length ? `; ${fails.join(' and ')} failed` : carried.length ? `; ${carried.length} guardrail${carried.length > 1 ? 's' : ''} carried as stop conditions` : ''}` },
    { look: `A synthetic scenario comparison: the same plan and rules with ${others6} other simulated outcomes, none of them observed. Only the conclusion changes: no effect is not a win, a worse B is stopped, and incomplete data hides every rate until it is fixed.`,
      fact: 'Simulated scenarios: no effect, a worse B, incomplete or missing data each read differently',
      then: 'These scenarios show how the recommendation changes with the evidence. Next, return to the main case: the positive simulated result from step 5.' },
                                                                               
    { top: n === 7 && tour.step === 7 ? mainCase() : '', look: `${st.planning_ready_allowed === 1 ? 'Both reviews are marked Pass on checked evidence, so the gate allows <b>Planning Ready</b>; risks the data could not clear stay conditions to address before a real experiment.' : `The gate is not met (missing ${esc(missing.join(', ') || 'an intact import')}), so <b>Planning Ready</b> stays locked.`} Planning Ready means you can prepare an independent real experiment; it does not approve rolling out B. The decision form contains a system draft for the Product Owner to review and rewrite. <a href="#/opportunities/${oppId}">Back to the options</a>.`, fact: '' },
  ][n - 1];
}
                                                                                                
const VERDICT = { 'Planning Ready': ['pass', 'Planning Ready'], 'Need More Evidence': ['warn', 'Need more evidence'], 'Stop / Blocked': ['fail', 'Stop'] };
                                                                                                   
                                                                                                                                   
                                                                     
const names = list => (list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0]);
const cause = g => { const r = String(g.reason ?? '').split(';')[0].trim().replace(/\.$/, ''); return r ? r[0].toLowerCase() + r.slice(1) : 'the data were not available'; };
function notCleared(a, why) {
  const carried = a.guardrails.filter(g => g.carry), label = g => g.label.toLowerCase(), parts = [];
  const inc = carried.filter(g => g.verdict === 'Inconclusive').map(label);
  if (inc.length) parts.push(why ? `${names(inc)} — a fall beyond the agreed limit cannot be ruled out yet` : `${names(inc)} (a fall beyond the agreed limit cannot be ruled out yet)`);
  const byCause = new Map();
  for (const g of carried.filter(x => x.verdict === 'Unknown')) { const k = why ? cause(g) : ''; byCause.set(k, [...(byCause.get(k) ?? []), label(g)]); }
  for (const [c, list] of byCause) parts.push(why ? `${names(list)} — not measured: ${c}` : `${names(list)} (not measured yet)`);
  return [...parts, ...carried.filter(g => !['Inconclusive', 'Unknown'].includes(g.verdict)).map(g => `${label(g)} (${g.verdict.toLowerCase()})`)];
}
                                                                                                                                    
                                                                                                      
export function scenarioRecommendation(s) {
  const checked = s.ev.evidenceStatus === 'Synthetic Evidence Checked', v = verdictFor(s.c, true), [tone, name] = VERDICT[v];
  const when = v === 'Planning Ready' ? 'Prepare a real experiment, not a rollout. Only if this evidence passes its checks and both reviews (treatment design and evidence) pass; no review is recorded for this simulated scenario. Guardrails not cleared become stop conditions for a real test.'
    : v === 'Stop / Blocked' ? 'B made the primary metric worse.'
    : !checked ? 'The evidence checks have not passed, so Planning Ready is locked.'
    : s.a.guardrails.some(g => g.verdict === 'Fail') ? 'A guardrail failed, so Planning Ready is locked even if the primary metric improves.'
    : 'The result does not show that B improves the primary metric.';
  return `${pill(tone, name)}<div class="small" style="margin-top:4px">${esc(when)}</div>`;
}
                                                                                                            
function scenarioGuardrails(s) {
  if (s.ev.evidenceStatus !== 'Synthetic Evidence Checked') return 'Not evaluated: the evidence checks have not passed.';
  const failed = s.a.guardrails.filter(g => g.verdict === 'Fail').map(g => g.label.toLowerCase()), open = notCleared(s.a, true), c = {};
  for (const g of s.a.guardrails) c[g.verdict] = (c[g.verdict] ?? 0) + 1;
  return [failed.length && `Failed: ${failed.join(', ')}.`, open.length && `Not cleared by the data: ${open.join('; ')}.`, `(${Object.entries(c).map(([k, n]) => `${n} ${k}`).join(' · ')})`].filter(Boolean).join(' ');
}
                                                                                                                                 
                                                                                                                        
                                                                                            
                                                                                                    
function mainCase() {
  const { st, ev, an } = tourLive(), s = an?.checked ? ev.statistics : null, checking = integrityOf(st.evidence_id) === 'checking';
  const v = checking ? null : defaultVerdict(experiments(db).find(e => e.experiment_id === tour.expId)), open = an?.checked ? notCleared(an, false) : [];
  return `<span data-main-case>Main case: evidence ${esc(st.evidence_id ?? 'none')}, the simulated result from step 5: ${s ? `B ${pp(s.difference)} (95% CI ${pp(s.ci95[0])} to ${pp(s.ci95[1])})` : 'not checked yet'}.
    <span data-recommended>${checking ? 'Recommended decision: checking the evidence…' : `Recommended decision: <b>${VERDICT[v][1]}</b>, ${st.decision_id ? `recorded as ${esc(st.decision_id)}` : 'not recorded and not approved: the tour records no decision'}.`}</span>${open.length ? ` Still not cleared: ${esc(open.join('; '))}.` : ''}</span> `;
}
                                                                                                                      
                                                          
                                                                                                       
                                                                                                                       
const TERMS_PLAN = 'MDE: the smallest improvement the test is planned to detect; it is not a threshold of business value. If B truly improves by that much, the plan has an 80% chance of detecting it (80% power); if B has no effect, it has a 5% chance of a false alarm (α = 0.05). Neither is the chance that the experiment succeeds or that a particular result is wrong.';
const TERMS_GUARD = 'Inconclusive: a fall beyond the agreed limit cannot be ruled out yet. Unknown: the data needed were not available; it does not mean no risk.';
export function tourEvidence(n) {
  const { f, oppId, expId } = tour, { st, plan } = tourLive(), seg = segLabel(f.segment);
  const reviews = [st.design_review_id, st.evidence_review_id].filter(Boolean);
  const chain = [`finding ${f.id}`, `opportunity ${oppId}`, `experiment ${expId}`, `plan v${plan.planVersion} (${plan.fingerprint.slice(0, 8)})`,
    st.evidence_id ? `evidence ${st.evidence_id}` : null, reviews.length ? `reviews ${reviews.join(', ')}` : null];
  const upTo = k => chain.slice(0, k).filter(Boolean).join(' → ');
  return [
    { href: '#/monitor', monitor: true, what: `${seg} on its own, over the same two windows`, context: upTo(1) },
    { href: `#/findings/${f.id}`, what: 'the finding behind the highlighted row', context: upTo(2),
                                                                                                                          
      terms: 'Adjusted p accounts for the multiple comparisons made in this scan, using the Holm method. It is compared with the significance threshold; it is not the probability that this finding is wrong.' },
    { href: `#/findings/${f.id}`, focus: 'causes', what: 'the possible causes and the evidence still missing', context: upTo(2) },
    { href: `#/experiments/${expId}/plan`, focus: 'plan-seal', what: 'the sealed plan', context: upTo(4), terms: TERMS_PLAN },
    { href: `#/experiments/${expId}/results`, focus: 'evidence-binding', what: 'the evidence record: file, evidence ID and cut-off', context: upTo(5),
      terms: 'pp: percentage points. 95% CI: the range of effects the data are consistent with.' },
    { href: `#/experiments/${expId}/plan`, focus: 'plan-seal', label: 'View the frozen plan these simulated scenarios share',
      what: 'It shows the metric, MDE and analysis rules are the same in every scenario; it does not by itself show that each result is computed correctly. Each scenario\'s data, result and basis are on step 6.', context: upTo(4), terms: TERMS_GUARD },
    { href: `#/experiments/${expId}/risk`, focus: 'reviews', what: 'the two review records', context: upTo(6), terms: TERMS_GUARD },
  ][n - 1];
}
export function tourBar() {
  const n = tour.step, home = `#/tour/${n}`, away = location.hash !== home, t = tourText(n), facts = TOUR.slice(0, n - 1).map((_, i) => tourText(i + 1).fact), e = tourEvidence(n);
  return `<section class="tourbar" aria-label="Guided tour"><div class="tb-top"><b>Tour · step ${n} of ${TOUR.length}</b>
      <ol class="tb-steps">${TOUR.map(([title], i) => `<li><a href="#/tour/${i + 1}" title="${esc(title)}" class="${i + 1 < n ? 'done' : ''}" ${i + 1 === n ? 'aria-current="step"' : ''}>${i + 1}</a></li>`).join('')}</ol>
      <span class="small tb-ro">Read-only: nothing in the tour can be changed or saved.</span><span class="spacer"></span><button class="btn small" data-act="tour-try">Try it yourself</button><button class="btn small" data-act="tour-exit">Exit tour</button></div>
    <div class="tb-body"><div class="stack"><h2>${TOUR[n - 1][0]}</h2><p>${t.top ?? ''}${t.look}</p>
      <p class="small tb-evidence"><button class="btn small" data-act="tour-evidence">${esc(e.label ?? 'View supporting evidence')}</button> ${esc(e.what)}</p>
      ${away && tour.evidenceStep === n ? `<p class="small tb-context" data-tour-context><b>Case context:</b> ${esc(e.context)}. Same read-only tour data.</p>${e.terms ? `<p class="small tb-context" data-tour-terms><b>What the terms mean:</b> ${esc(e.terms)}</p>` : ''}` : ''}
      ${away ? `<p class="small">You opened a detail page. <a href="${home}">Back to step ${n}</a></p>` : ''}</div>
      ${facts.length ? fold('The case so far', `<div class="tb-case"><h3>The case so far</h3><ol>${facts.map((f, i) => `<li><a href="#/tour/${i + 1}">${esc(f)}</a></li>`).join('')}</ol></div>`) : '<div class="tb-case"><h3>The case</h3><p class="small">A UK online shop, 90 days of synthetic checkouts. The tour uses its own copy, so nothing here changes your workspace.</p></div>'}</div>
    ${t.then ? `<p class="small" data-tour-then>${esc(t.then)}</p>` : ''}<div class="tb-nav">${n > 1 ? `<a class="btn" href="#/tour/${n - 1}">${icon('back')} ${TOUR[n - 2][0]}</a>` : '<span></span>'}
      ${n < TOUR.length ? `<a class="btn primary" href="#/tour/${n + 1}">${n === 6 ? 'Return to the main case' : 'Next'}: ${TOUR[n][0]} ${icon('chev')}</a>` : '<button class="btn primary" data-act="tour-exit">Finish the tour</button>'}</div></section>`;
}
                                                                                                
                                                                                          
                                                                        
const PLAIN = { 'No detectable effect': 'No clear effect: the result could be zero.',
  'Not enough evidence yet': 'Not enough evidence yet: the data have not met the plan’s checks, so no result is shown.' };
export function tourScenarios() {
  const sc = tour.scenarios;
  const items = sc.map(s => ({ label: s.label, tone: s.c.tone, test: s.ev.evidenceStatus === 'Synthetic Evidence Checked' && s.ev.statistics ? { diff: s.ev.statistics.difference, ci: s.ev.statistics.ci95 } : null }));
  return shell('experiments', `${head('When the result is not a win')}
    <div class="callout warn section" style="margin-top:0" data-synthetic-scenarios><b>Synthetic scenario comparison</b>Every outcome on this page is simulated from the same plan, to show how the product reads different results. None of them is an observed result. Each row shows its data condition, evidence status, result and the reason for its conclusion.</div>
    <section class="panel pad stack"><h2>One plan, ${WORDS[sc.length] ?? sc.length} simulated outcomes</h2><p class="small muted">Each line is B − A on payment submission with its 95% interval. Plan v${tour.plan.planVersion} (${tour.plan.mdePP} pp MDE) and the rules are identical in every row.</p>${intervalChart(items, tour.plan.mdePP)}</section>
    <section class="panel section"><div class="table-scroll"><table class="data scenarios"><thead><tr><th>Scenario</th><th>Data condition</th><th>Evidence status</th><th class="num">Result: B − A (95% CI)</th><th>What the product concludes, and why</th><th>Recommended decision</th><th>Guardrails</th></tr></thead><tbody>
      ${sc.map(s => { const st = s.a.checked && s.ev.statistics; return `<tr><td><b>${esc(s.label)}</b></td><td class="small">${esc(s.how)}</td><td class="small">${esc(s.ev.evidenceStatus)}</td>
        <td class="num small">${st ? `${pp(st.difference)}<br>(${pp(st.ci95[0])} to ${pp(st.ci95[1])})` : 'Not shown: counts only until the checks pass'}</td>
        <td>${pill(s.c.tone === 'pass' ? 'pass' : s.c.tone === 'fail' ? 'fail' : 'warn', s.c.title)}${PLAIN[s.c.title] ? `<div style="margin-top:4px" data-plain>${esc(PLAIN[s.c.title])}</div>` : ''}<div class="small" style="margin-top:4px">${esc(s.c.text)}</div></td><td data-recommendation>${scenarioRecommendation(s)}</td><td class="small" data-guardrails>${esc(scenarioGuardrails(s))}</td></tr>`; }).join('')}</tbody></table></div></section>`);
}
export function tourPage() {
  return shell('tour', `${head('5-minute tour')}<section class="panel pad stack"><p>One checkout case from the first signal to the decision, in seven connected steps. Each step opens the real workspace page for the same case. A bar on top keeps the thread: what we know so far, what to look at now, and the way to the next step.</p>
    <ol class="tour-list">${TOUR.map(([t, d], i) => `<li><span class="tl-n">${i + 1}</span><div><b>${t}</b><p class="small muted">${d}</p></div><a class="small" href="#/tour/${i + 1}">Open step</a></li>`).join('')}</ol>
    <div class="row"><a class="btn primary" href="#/tour/${tour?.step ?? 1}">${tour ? `Continue at step ${tour.step}` : 'Start the tour'} ${icon('chev')}</a><span class="small muted">The tour builds its own copy of the sample data and is read-only: the same case and numbers every time, and your workspace is not changed. Synthetic data throughout.</span></div></section>`);
}
