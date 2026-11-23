                                                                
                                                                                                 
                                                                                                                     
                                                   
import { compare } from './analytics.mjs';

                                                                                                                     
                                                             
export const ANALYSIS_RULES_VERSION = 'pcl-analysis-3.0';
                                                                                           
export const UNKNOWN_AUTH_LIMIT = 0.05;
const WINDOW_MS = 30 * 60_000, AUTH_WINDOW_MS = 60 * 60_000;
export const AUTH_METRIC = 'PAYMENT_AUTH_APPROVAL_60M_ITT';
                                                                                                                          
export const authPrimary = evidence => evidence?.binding?.metricId === AUTH_METRIC;

function perCheckout(rows) {
  const by = new Map();
  for (const r of rows) {
    if (!r.eligible) continue;
    let c = by.get(r.checkout_id);
    if (!c) by.set(r.checkout_id, c = { variant: r.variant, assigned: Date.parse(r.assigned_at), day: r.assigned_at.slice(0, 10), submitted30: false, submitted: false,
      reached: false, approved: false, authMissing: false, authUnknown: false, amount: r.amount_minor, channel: r.channel, method: r.payment_method,
      outcomeUnknown: false, approvals: [] });
    if (r.outcome_known !== true) c.outcomeUnknown = true;                                                                                   
                                                                                                                                  
    if (r.auth_result === 'approved' && r.auth_at && r.submitted_at) {
      const at = Date.parse(r.auth_at), sub = Date.parse(r.submitted_at);
      if (at >= sub && at >= c.assigned && at - c.assigned <= AUTH_WINDOW_MS) c.approvals.push({ at, sub, id: r.record_id, amount: r.amount_minor });
    }
    if (r.submitted_at) {
      c.submitted = true;
      if (Date.parse(r.submitted_at) - c.assigned <= WINDOW_MS) c.submitted30 = true;
      if (!r.auth_result) c.authMissing = true;                                                        
    }
    if (r.auth_result && r.auth_result !== 'not_reached') c.reached = true;
    if (r.auth_result === 'approved') c.approved = true;
    if (r.auth_result === 'unknown') c.authUnknown = true;                                                           
  }
  for (const c of by.values()) {
                                                                                                                                 
                                                                                     
    c.ok60 = c.approvals.length > 0;
    if (c.ok60) {
      const first = [...c.approvals].sort((x, y) => x.at - y.at || x.sub - y.sub || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
      const tied = first.filter(x => x.at === first[0].at);
      c.firstAmount = tied.every(x => x.amount === tied[0].amount) ? tied[0].amount ?? null : null;
    }
  }
  return [...by.values()];
}
const agg = list => list.reduce((a, c) => ({ n: a.n + 1, s30: a.s30 + c.submitted30, sub: a.sub + c.submitted, reached: a.reached + c.reached, approved: a.approved + c.approved,
  authMissing: a.authMissing + (c.submitted && c.authMissing), authUnknown: a.authUnknown + (c.reached && !c.approved && c.authUnknown), amtMissing: a.amtMissing + (c.approved && c.amount == null),
  amt: a.amt + (c.approved ? c.amount ?? 0 : 0), amt2: a.amt2 + (c.approved ? (c.amount ?? 0) ** 2 : 0),
  unknownOutcome: a.unknownOutcome + c.outcomeUnknown, ok60: a.ok60 + c.ok60, firstMissing: a.firstMissing + (c.ok60 && c.firstAmount == null),
  firstAmt: a.firstAmt + (c.ok60 ? c.firstAmount ?? 0 : 0), firstAmt2: a.firstAmt2 + (c.ok60 ? (c.firstAmount ?? 0) ** 2 : 0) }),
  { n: 0, s30: 0, sub: 0, reached: 0, approved: 0, authMissing: 0, authUnknown: 0, amtMissing: 0, amt: 0, amt2: 0, unknownOutcome: 0, ok60: 0, firstMissing: 0, firstAmt: 0, firstAmt2: 0 });

function meanCompare(a, b, n = 'approved', sum = 'amt', sum2 = 'amt2') {
  if (a[n] < 2 || b[n] < 2) return null;
  const ma = a[sum] / a[n], mb = b[sum] / b[n];
  const va = (a[sum2] - a[n] * ma * ma) / (a[n] - 1), vb = (b[sum2] - b[n] * mb * mb) / (b[n] - 1);
  const se = Math.sqrt(va / a[n] + vb / b[n]), diff = mb - ma;
  return { p1: ma, p2: mb, diff, ci: [diff - 1.959964 * se, diff + 1.959964 * se] };
}

                                                                                                      
                                                                                                                                
export function judgeGuardrail(g, test, missingReason) {
  if (!test) return { verdict: 'Unknown', level: 'Missing Data', reason: missingReason ?? g.noDataReason ?? 'No data for this guardrail during the test.', carry: true };
  const flat = g.unit === 'pp' ? [test.p1, test.p2].some(p => p <= 0 || p >= 1) : !(test.ci[1] - test.ci[0] > 0);
  if (flat) return { verdict: 'Unknown', level: 'Missing Data', carry: true, reason: 'No variation in this metric (every checkout has the same outcome in a group), so the interval cannot rule out harm.' };
  const scale = g.unit === 'pp' ? 100 : 1 / 100, point = test.diff * scale, lower = test.ci[0] * scale, upper = test.ci[1] * scale, tol = g.tolerance;
  const fmt = v => (g.unit === 'pp' ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)} pp` : `${v >= 0 ? '+' : '−'}£${Math.abs(v).toFixed(2)}`), tolTxt = g.unit === 'pp' ? `−${tol} pp` : `−£${tol}`;
  if (lower > -tol) return { verdict: 'Pass', level: 'Verified With Available Data', reason: `Harm beyond ${tolTxt} is ruled out: the 95% interval starts at ${fmt(lower)}.` };
  if (upper < 0 && point < -tol) return { verdict: 'Fail', level: 'Verified With Available Data', reason: `Significantly worse and beyond the ${tolTxt} tolerance (change ${fmt(point)}, upper bound ${fmt(upper)}).` };
  return { verdict: 'Inconclusive', level: 'Verified With Available Data', carry: true, reason: `Change ${fmt(point)}, but the 95% interval reaches ${fmt(lower)}, so harm beyond ${tolTxt} cannot be ruled out yet.` };
}
export const stopCondition = g => (g.unit === 'pp' ? `stop if ${g.label.toLowerCase()} falls by more than ${g.tolerance} pp` : g.unit === '£' ? `stop if ${g.label.toLowerCase()} falls by more than £${g.tolerance}` : `monitor ${g.label.toLowerCase()} as a required check`);

export function analyse(rows, evidence, guardrails) {
  const checked = evidence.evidenceStatus === 'Synthetic Evidence Checked';
  const cs = perCheckout(rows), A = agg(cs.filter(c => c.variant === 'A')), B = agg(cs.filter(c => c.variant === 'B'));
  const s = evidence.statistics, share = (x, n) => (n ? `${(x / n * 100).toFixed(1)}%` : '0%');
                                                                                              
  const exact = (x, n) => `${x.toLocaleString('en-GB')} of ${n.toLocaleString('en-GB')} (${n ? (x / n * 100).toFixed(2) : '0.00'}%)`;
  const authGap = A.authMissing + B.authMissing, unkShare = x => (x.reached ? x.authUnknown / x.reached : 0), unkHigh = Math.max(unkShare(A), unkShare(B)) > UNKNOWN_AUTH_LIMIT;
  const authReason = authGap ? `Authorisation outcome missing for ${share(authGap, A.sub + B.sub)} of submitted checkouts.`
    : unkHigh ? `The bank's answer is unknown for ${exact(A.authUnknown, A.reached)} in A and ${exact(B.authUnknown, B.reached)} in B, of checkouts that reached it; the limit is more than ${UNKNOWN_AUTH_LIMIT * 100}% in either group.` : null;
  const amtGap = A.amtMissing + B.amtMissing, amtReason = amtGap ? `Order amount missing for ${share(amtGap, A.approved + B.approved)} of approved checkouts.` : null;
  const auth = authPrimary(evidence);
                                                    
  const subReason = A.unknownOutcome + B.unknownOutcome ? `Outcome unknown for ${share(A.unknownOutcome + B.unknownOutcome, A.n + B.n)} of checkouts; a checkout recorded as not submitted is known, these are not.` : null;
  const aovReason = !A.ok60 || !B.ok60 ? `No approved checkouts in group ${!A.ok60 ? 'A' : 'B'}, so the average approved order cannot be computed.`
    : A.firstMissing + B.firstMissing ? `Order amount missing, or different between approvals at the same time, for ${share(A.firstMissing + B.firstMissing, A.ok60 + B.ok60)} of approved checkouts.`
    : A.ok60 < 2 || B.ok60 < 2 ? 'Fewer than 2 approved checkouts in a group, so the interval cannot be computed.' : null;
  const authMetrics = [
    { id: 'auth', label: 'Authorisation conversion (≤60 min) — primary', a: [evidence.counts.A.success, evidence.counts.A.assigned], b: [evidence.counts.B.success, evidence.counts.B.assigned],
      test: s ? { p1: evidence.rates.A, p2: evidence.rates.B, diff: s.difference, ci: s.ci95, p: s.pValue } : null, primary: true },
    { id: 'submission', label: 'Payment submission (≤30 min)', a: [A.s30, A.n], b: [B.s30, B.n], missing: subReason, test: subReason ? null : compare(A.s30, A.n, B.s30, B.n) },
    { id: 'aov', label: 'Average approved order (first approval)', a: [A.firstAmt, A.ok60], b: [B.firstAmt, B.ok60], missing: aovReason, test: aovReason ? null : meanCompare(A, B, 'ok60', 'firstAmt', 'firstAmt2'), money: true },
    { id: 'approval', label: 'Issuer approval — diagnostic, not a guardrail', a: [A.approved, A.reached], b: [B.approved, B.reached], missing: authReason, test: authReason ? null : compare(A.approved, A.reached, B.approved, B.reached), diagnostic: true },
  ];
  const metrics = auth ? authMetrics : [
    { id: 'submission', label: 'Payment submission (≤30 min) — primary', a: [evidence.counts.A.success, evidence.counts.A.assigned], b: [evidence.counts.B.success, evidence.counts.B.assigned],
      test: s ? { p1: evidence.rates.A, p2: evidence.rates.B, diff: s.difference, ci: s.ci95, p: s.pValue } : null, primary: true },
    { id: 'auth', label: 'Authorisation conversion', a: [A.approved, A.n], b: [B.approved, B.n], missing: authReason, test: authReason ? null : compare(A.approved, A.n, B.approved, B.n) },
    { id: 'approval', label: 'Issuer approval', a: [A.approved, A.reached], b: [B.approved, B.reached], missing: authReason, test: authReason ? null : compare(A.approved, A.reached, B.approved, B.reached) },
    { id: 'aov', label: 'Average approved order', a: [A.amt, A.approved], b: [B.amt, B.approved], missing: amtReason ?? authReason, test: amtReason || authReason ? null : meanCompare(A, B), money: true },
  ];
  const key = auth ? 'ok60' : 's30';                                                                   
  const days = [...new Set(cs.map(c => c.day))].sort();
  const cum = { A: { n: 0, s: 0 }, B: { n: 0, s: 0 } }, daily = [], cumulative = [];
  for (const d of days) {
    const today = { A: agg(cs.filter(c => c.day === d && c.variant === 'A')), B: agg(cs.filter(c => c.day === d && c.variant === 'B')) };
    daily.push({ day: d, nA: today.A.n, nB: today.B.n, A: today.A.n ? today.A[key] / today.A.n : null, B: today.B.n ? today.B[key] / today.B.n : null });
    for (const v of ['A', 'B']) { cum[v].n += today[v].n; cum[v].s += today[v][key]; }
    const t = compare(cum.A.s, cum.A.n, cum.B.s, cum.B.n);
    if (t) cumulative.push({ day: d, diff: t.diff, ci: t.ci });
  }
  const funnel = ['A', 'B'].map(v => { const x = v === 'A' ? A : B; return { variant: v, steps: [['Assigned', x.n], ['Submitted', x.sub], ['Reached the bank', x.reached], ['Approved', x.approved]] }; });
  const seg = dim => [...new Set(cs.map(c => c[dim]).filter(Boolean))].map(val => {
    const a = agg(cs.filter(c => c[dim] === val && c.variant === 'A')), b = agg(cs.filter(c => c[dim] === val && c.variant === 'B'));
    return { value: val, a: [a[key], a.n], b: [b[key], b.n], test: checked ? compare(a[key], a.n, b[key], b.n) : null };
  });
  if (!checked) {
    for (const m of metrics) m.test = null;
    for (const d of daily) { d.A = null; d.B = null; }                                                      
  }
  const byId = Object.fromEntries(metrics.map(m => [m.id, m]));
                                                                                                                              
                                                                                  
  const risks = guardrails.filter(g => g.kind === 'risk').map(g => ({ ...g, verdict: 'Not verified', level: 'Unverified risk', reason: g.noDataReason, carry: true }));
  const guards = guardrails.filter(g => g.kind !== 'risk').map(g => {
    if (!checked) return { ...g, verdict: 'Not evaluated', level: 'Not Verified', reason: 'Evaluated only after the evidence passes its checks.' };
    const m = g.metric ? byId[g.metric] : null;
    return { ...g, ...judgeGuardrail(g, m?.test ?? null, m?.missing ?? null) };
  });
  return { checked, rulesVersion: ANALYSIS_RULES_VERSION, metrics, daily, cumulative: checked ? cumulative : [], funnel,
    segments: { channel: seg('channel'), payment_method: seg('method') }, guardrails: guards, risks, primaryId: auth ? 'auth' : 'submission' };
}

export function conclusion(evidence, analysis) {
  const s = evidence.statistics, fails = analysis.guardrails.filter(g => g.verdict === 'Fail'), carried = analysis.guardrails.filter(g => g.carry);
  if (evidence.evidenceStatus === 'Stop / Blocked') return { tone: 'fail', title: 'Data problem: no result can be read', text: `Blocked: ${evidence.issues.join(', ').toLowerCase().replace(/_/g, ' ')}. Fix the data before reading any result.` };
  if (evidence.evidenceStatus !== 'Synthetic Evidence Checked') return { tone: 'warn', title: 'Not enough evidence yet', text: `${evidence.need.map(n => n.toLowerCase().replace(/_/g, ' ')).join('; ')}. No effect is reported until the plan's conditions are met.` };
  const pp = (s.difference * 100).toFixed(2), lo = (s.ci95[0] * 100).toFixed(2), hi = (s.ci95[1] * 100).toFixed(2);
  const auth = authPrimary(evidence), name = auth ? 'authorisation conversion' : 'payment submission', short = auth ? 'authorisation conversion' : 'submission';
  const carriedTxt = carried.length ? ` ${carried.length} guardrail${carried.length > 1 ? 's' : ''} (${carried.map(g => g.label.toLowerCase()).join(', ')}) could not be cleared and become stop conditions for a real test.` : '';
  if (s.ci95[0] > 0 && !fails.length) return { tone: 'pass', title: 'B improves the primary metric', text: `B raised ${name} by ${pp} pp (95% CI ${lo} to ${hi}). No guardrail failed.${carriedTxt}` };
  if (s.ci95[0] > 0) return { tone: 'fail', title: `Better on ${short}, but a guardrail failed`, text: `B raised ${short} by ${pp} pp, but ${fails.map(f => f.label.toLowerCase()).join(' and ')} failed. Planning Ready is not possible.` };
  if (s.ci95[1] < 0) return { tone: 'fail', title: 'B is worse', text: `B lowered ${name} by ${Math.abs(pp)} pp (95% CI ${lo} to ${hi}). Stop this option.` };
  return { tone: 'warn', title: 'No detectable effect', text: `${pp} pp (95% CI ${lo} to ${hi}) includes zero. The test was sized for the planned MDE; a smaller real effect cannot be ruled out.` };
}
