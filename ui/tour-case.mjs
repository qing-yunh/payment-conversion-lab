                                                                                  
                                                                                   
import { addDays, dataRange, defaultWindows, diagnose, estimate, optionsFor } from '../engine/analytics.mjs';
import { analyse, conclusion } from '../engine/results.mjs';
import { simulateResults } from '../engine/simulate.mjs';
import { auditRows, createExperiment, createOpportunity, evidenceFor, experiments, freeze, importResults, recordReview } from '../store/store.mjs';
import { planNumbersIn } from './plan-numbers.mjs';

export function horizonOf(plan, list) {
  let last = 0;
  for (const r of list) for (const k of ['assigned_at', 'exposed_at', 'submitted_at']) if (r[k]) last = Math.max(last, Date.parse(r[k]));
  const win = (plan.observationWindowMinutes ?? 30) * 60_000;                                                                          
  return new Date(Math.max(last + win, Date.parse(plan.enrollmentEnd) + win + 1000)).toISOString().replace(/\.\d{3}Z$/, 'Z');
}
                                                                                                                                     
export async function buildTourCase(db) {
  const d = diagnose(db, defaultWindows(db)), f = d.findings.find(x => x.type === 'PRE_SUBMIT_LOSS' && x.kind === 'change');
  if (!f) throw new Error('The sample has no loss-before-Pay finding for the tour to follow.');
  const oppId = createOpportunity(db, { ...f, window: d.window }), rule = optionsFor(f).find(x => x.id === 'R-FF1');
  const expId = createExperiment(db, oppId, rule, f.segment), x = experiments(db).find(e => e.experiment_id === expId), est = estimate(db, f, rule, d.window);
  const n = planNumbersIn(db, x, { mde: est.mde, start: addDays(dataRange(db).last, 1), days: Math.ceil(est.testDays * 1.1) });
                                                                                                           
  const plan = await freeze(db, expId, { baselineRate: +n.base.toFixed(4), mdePP: est.mde, enrollmentStart: n.start + 'T00:00:00Z', enrollmentEnd: n.end + 'T23:59:59Z', frozenAt: dataRange(db).last + 'T18:00:00.000Z' });
  const effect = +(est.mde * 1.3).toFixed(1), sim = (e, seed) => simulateResults(db, { plan, segment: f.segment, trueEffectPP: e, seed });
  const won = sim(effect, 'tour-win');
  const ev = await importResults(db, { experimentId: expId, plan, rows: won, fileName: `${expId}-tour-results.csv`, coverageThrough: horizonOf(plan, won), coverageComplete: true });
  const an = analyse(evidenceFor(db, ev.id).rows, ev, x.guardrails);
  await recordReview(db, { experimentId: expId, type: 'treatment_design', outcome: 'Pass', level: 'Design Review Only', checks: ['sca', 'data', 'a11y'].map(id => ({ id, ok: true })) });
  await recordReview(db, { experimentId: expId, type: 'evidence', evidenceId: ev.id, outcome: an.guardrails.some(g => g.verdict === 'Fail') ? 'Fail' : 'Pass', level: 'Verified With Available Data', checks: an.guardrails });
  const scenario = async (label, how, list, complete) => { const e = await auditRows({ plan, rows: list, coverageThrough: horizonOf(plan, list), coverageComplete: complete, evidenceId: 'EV-TOUR' }), a = analyse(list, e, x.guardrails); return { label, how, ev: e, a, c: conclusion(e, a) }; };
  const scenarios = [{ label: 'The step 5 result', how: `True effect set to +${effect} pp`, ev, a: an, c: conclusion(ev, an) },
    await scenario('No real effect', 'True effect set to 0 pp', sim(0, 'tour-null'), true),
    await scenario('B is worse', 'True effect set to −2 pp', sim(-2, 'tour-harm'), true),
    await scenario('Export not confirmed complete', 'Step 5 rows; completeness box left unticked', won, false),
    await scenario('Authorisation outcomes missing', 'Step 5 rows; 1 in 11 submitted rows lose auth_result', won.map((r, i) => (r.submitted_at && i % 11 === 0 ? { ...r, auth_result: null } : r)), true)];
  return { d, f, rule, oppId, expId, plan, ev, an, est, effect, scenarios };
}
