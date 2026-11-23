                                                                                                 
                                                                                                           
import { assignCheckout } from '../domain/checkout-plan.mjs';
import { rng, checkoutProfile, attemptOutcome } from './sample-data.mjs';
import { totals, segFilter, defaultWindows, daysBetween } from './analytics.mjs';

                                                                                                                          
                                                                                                                       
                                                                                                                             
                                                             
const AUTH_METRIC = 'PAYMENT_AUTH_APPROVAL_60M_ITT', ISSUER_RESULTS = new Set(['approved', 'declined', 'error']);
const authTime = ts => new Date(ts + 2_000 + (ts % 18_000)).toISOString();
                                                                                                            
                                                                                                                                
                                                                                                                                   
                                                                                    
function resolvedAnswer(r, { attemptNo, issuerRegion }) {
  const approveP = attemptNo === 1 ? (issuerRegion === 'EEA' ? 0.80 : 0.905) : 0.7, x = r() * (1 - (1 - approveP) * 0.03);
  return x < approveP ? 'approved' : x < approveP + (1 - approveP) * 0.94 ? 'declined' : 'error';
}
export function simulateResults(db, { plan, segment, trueEffectPP, seed = 'sim-1', answers = 'as generated' }) {
  const win = defaultWindows(db), t = totals(db, segFilter(segment), ...win.cur);
  const daily = t.started / daysBetween(...win.cur), baseRate = t.submitted / t.started;
  const r = rng(`${seed}|${plan.fingerprint}|${trueEffectPP}`);
  const authPlan = plan.metricId === AUTH_METRIC, r2 = rng(`${seed}|${plan.fingerprint}|${trueEffectPP}|auth`), baseAuth = t.approved / t.started;
  const resolve = answers === 'resolved', r3 = rng(`${seed}|${plan.fingerprint}|${trueEffectPP}|answers`);
                                                                                                                   
  const lift = authPlan && trueEffectPP > 0 ? Math.min(1, trueEffectPP / 100 / Math.max(1e-9, baseRate - baseAuth)) : 0;
  const drop = authPlan && trueEffectPP < 0 ? Math.min(1, -trueEffectPP / 100 / Math.max(1e-9, baseAuth)) : 0;
  const start = Date.parse(plan.enrollmentStart), end = Date.parse(plan.enrollmentEnd);
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1), rows = [];
  let seq = 0;
  for (let d = 0; d < days; d++) {
    const n = Math.round(daily * (0.92 + r() * 0.16));
    for (let i = 0; i < n; i++) {
      let p; do { p = checkoutProfile(r); } while (segment && String(p[{ channel: 'channel', payment_method: 'method', card_scheme: 'scheme', issuer_region: 'issuerRegion', customer_type: 'customer' }[segment.dim]] ?? 'n/a') !== segment.value);
      const t0 = start + d * 86_400_000 + Math.floor(r() * 86_000_000);
      if (t0 > end) continue;
      const id = `${plan.experimentId}-C${String(++seq).padStart(6, '0')}`;
      const variant = assignCheckout(plan.experimentId, id, plan.assignmentSeed);
      const assigned = new Date(t0).toISOString(), exposed = r() < 0.002 ? null : new Date(t0 + 5_000 + Math.floor(r() * 30_000)).toISOString();
      const submitP = Math.min(0.999, Math.max(0, baseRate + (variant === 'B' && !authPlan ? trueEffectPP / 100 : 0)));
      const base = { checkout_id: id, experiment_id: plan.experimentId, variant, eligible: true, assigned_at: assigned, exposed_at: exposed, outcome_known: true,
        channel: p.channel, payment_method: p.method };
      if (r() >= submitP) { rows.push({ ...base, record_id: id + '-0', submitted_at: null, auth_result: null, auth_at: null, amount_minor: p.amount }); continue; }
      const first = rows.length; let approvedAsGenerated = false;
      let ts = t0 + 60_000 + Math.floor(r() * 19 * 60_000);
      for (let a = 1; a <= 2; a++) {
        const o = attemptOutcome(r, { method: p.method, amount: p.amount, issuerRegion: p.issuerRegion, attemptNo: a, eeaShift: true });
        if (o.auth === 'approved') approvedAsGenerated = true;
        const answer = resolve && o.auth === 'unknown' ? resolvedAnswer(r3, { attemptNo: a, issuerRegion: p.issuerRegion }) : o.auth;
        rows.push({ ...base, record_id: `${id}-${a}`, submitted_at: new Date(ts).toISOString(), auth_result: answer, auth_at: ISSUER_RESULTS.has(answer) ? authTime(ts) : null, amount_minor: p.amount });
        if (o.auth === 'approved' || o.auth === 'unknown' || r() > 0.35) break;
        ts += 60_000 + Math.floor(r() * 4 * 60_000);
      }
      if (variant === 'B' && (lift || drop)) {                                                                                 
                                                                                                                                      
        const last = rows[rows.length - 1], approved = approvedAsGenerated;
        if (lift && !approved && r2() < lift) rows[rows.length - 1] = { ...last, auth_result: 'approved', auth_at: authTime(Date.parse(last.submitted_at)) };
        else if (drop && approved && r2() < drop) rows[rows.length - 1] = { ...last, auth_result: 'declined', auth_at: authTime(Date.parse(last.submitted_at)) };
      }
    }
  }
  return rows;
}
