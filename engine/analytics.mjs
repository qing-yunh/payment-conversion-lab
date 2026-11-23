                                                                                   
                                                                                              
import { requiredPerArm } from '../domain/checkout-plan.mjs';

export const DIMS = Object.freeze({
  channel: { label: 'Channel', values: { web_mobile: 'Mobile web', web_desktop: 'Desktop web', app: 'App' } },
  payment_method: { label: 'Payment method', values: { card: 'Card', wallet: 'Wallet', pay_by_bank: 'Pay by Bank' } },
  card_scheme: { label: 'Card scheme', values: { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', 'n/a': 'Not a card' } },
  issuer_region: { label: 'Issuer region', values: { UK: 'UK', EEA: 'EEA', RoW: 'Rest of world', 'n/a': 'Not a card' } },
  customer_type: { label: 'Customer', values: { new: 'New', returning: 'Returning' } },
});
export const METRICS = Object.freeze({
  submission: { label: 'Payment submission', num: 'submitted', den: 'started', def: 'Checkouts with at least one submitted payment ÷ checkouts started' },
  auth: { label: 'Authorisation conversion', num: 'approved', den: 'started', def: 'Checkouts with an approved payment ÷ checkouts started' },
  approval: { label: 'Issuer approval', num: 'approved', den: 'reached', def: 'Approved ÷ reached the card issuer (unknown outcomes stay in the denominator)' },
  challenge: { label: '3-D Secure challenge completion', num: 'ch_done', den: 'ch', def: 'Completed challenges ÷ challenges started (attempt level)' },
});
const SUMS = 'SUM(started) started, SUM(submitted) submitted, SUM(reached) reached, SUM(approved) approved, SUM(unknown) unknown, SUM(ch) ch, SUM(ch_done) ch_done, SUM(approved_amount) approved_amount, SUM(soft_declined) soft_declined, SUM(soft_no_retry) soft_no_retry, SUM(if_no_retry) if_no_retry';

export function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try { stmt.bind(params); const out = []; while (stmt.step()) out.push(stmt.getAsObject()); return out; } finally { stmt.free(); }
}

export function buildCube(db) {
  db.exec(`DELETE FROM daily_cube;
    INSERT INTO daily_cube SELECT c.day, c.channel, c.payment_method, COALESCE(c.card_scheme, 'n/a'), COALESCE(c.issuer_region, 'n/a'), c.customer_type,
      COUNT(*), SUM(a.checkout_id IS NOT NULL), SUM(COALESCE(a.reached, 0)), SUM(COALESCE(a.ap, 0)), SUM(COALESCE(a.reached AND NOT a.ap AND a.unk, 0)),
      SUM(COALESCE(a.ch, 0)), SUM(COALESCE(a.chd, 0)), SUM(CASE WHEN a.ap THEN c.amount_minor ELSE 0 END),
      SUM(COALESCE(a.soft_max IS NOT NULL, 0)), SUM(COALESCE(a.soft_max = a.last AND NOT a.ap, 0)), SUM(COALESCE(a.if_max = a.last AND NOT a.ap, 0))
    FROM checkout c LEFT JOIN (SELECT checkout_id, MAX(auth_result <> 'not_reached') reached, MAX(auth_result = 'approved') ap, MAX(auth_result = 'unknown') unk,
      SUM(sca_path = 'challenge') ch, SUM(challenge_result = 'completed') chd, MAX(attempt_no) last,
      MAX(CASE WHEN auth_result = 'declined' AND decline_reason IN ('insufficient_funds', 'do_not_honour') THEN attempt_no END) soft_max,
      MAX(CASE WHEN auth_result = 'declined' AND decline_reason = 'insufficient_funds' THEN attempt_no END) if_max
      FROM payment_attempt GROUP BY checkout_id) a ON a.checkout_id = c.checkout_id
    GROUP BY 1, 2, 3, 4, 5, 6;`);
}

                                                                                 
function where(filters = {}, exclude = null, prefix = '') {
  const clauses = [], params = [];
  for (const [dim, values] of Object.entries(filters)) {
    if (!DIMS[dim] || !values?.length) continue;
    clauses.push(`${prefix}${dim} IN (${values.map(() => '?').join(',')})`); params.push(...values);
  }
  if (exclude && DIMS[exclude.dim]) { clauses.push(`${prefix}${exclude.dim} <> ?`); params.push(exclude.value); }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}
export const segFilter = seg => (seg ? { [seg.dim]: [seg.value] } : {});

export function dataRange(db) { return rows(db, 'SELECT MIN(day) first, MAX(day) last, COUNT(DISTINCT day) days FROM daily_cube')[0]; }
export function totals(db, filters, from, to, exclude) {
  const w = where(filters, exclude);
  return rows(db, `SELECT ${SUMS} FROM daily_cube WHERE day BETWEEN ? AND ?${w.sql}`, [from, to, ...w.params])[0];
}
export function dailySeries(db, filters, from, to, dim = null) {
  const w = where(filters);
  return rows(db, `SELECT day${dim ? ', ' + dim + ' k' : ''}, ${SUMS} FROM daily_cube WHERE day BETWEEN ? AND ?${w.sql} GROUP BY day${dim ? ', ' + dim : ''} ORDER BY day`, [from, to, ...w.params]);
}
export function breakdown(db, filters, dim, cur, base) {
  const w = where(filters);
  const q = (f, t) => rows(db, `SELECT ${dim} k, ${SUMS} FROM daily_cube WHERE day BETWEEN ? AND ?${w.sql} GROUP BY ${dim}`, [f, t, ...w.params]);
  const c = q(...cur), b = base ? Object.fromEntries(q(...base).map(r => [r.k, r])) : {};
  return c.map(r => ({ key: r.k, cur: r, base: b[r.k] ?? null }));
}
export function declineMix(db, filters, from, to) {
  const cl = [], params = [from, to];
  for (const [dim, values] of Object.entries(filters ?? {})) {
    if (!DIMS[dim] || !values?.length) continue;
    const real = values.filter(v => v !== 'n/a'), na = values.includes('n/a');
    const parts = [];
    if (real.length) { parts.push(`c.${dim} IN (${real.map(() => '?').join(',')})`); params.push(...real); }
    if (na) parts.push(`c.${dim} IS NULL`);
    cl.push('(' + parts.join(' OR ') + ')');
  }
  return rows(db, `SELECT pa.decline_reason reason, COUNT(*) n FROM payment_attempt pa JOIN checkout c USING (checkout_id)
    WHERE c.day BETWEEN ? AND ? AND pa.auth_result = 'declined'${cl.length ? ' AND ' + cl.join(' AND ') : ''} GROUP BY 1 ORDER BY n DESC`, params);
}

                       
export function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + Math.sign(x) * erf);
}
                                                                                                           
export function compare(n1, d1, n2, d2) {
  if (!(d1 > 0 && d2 > 0)) return null;
  const p1 = n1 / d1, p2 = n2 / d2, pooled = (n1 + n2) / (d1 + d2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / d1 + 1 / d2)), seU = Math.sqrt(p1 * (1 - p1) / d1 + p2 * (1 - p2) / d2);
  const diff = p2 - p1;
  const p = se > 0 ? Math.min(1, 2 * (1 - normalCdf(Math.abs(diff / se)))) : 1;
  return { p1, p2, diff, p, ci: [diff - 1.959964 * seU, diff + 1.959964 * seU] };
}
   
                                                                                                                
                                                                                                                              
                                                                                                
                                                                                                             
                                                                                                                                  
                                                                                                                                
                                                                    
   
const exactCount = x => {
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number' && Number.isSafeInteger(x)) return BigInt(x);
  throw new Error(`COUNT_NOT_EXACT: ${typeof x === 'number' ? x : typeof x} is not a whole number that can be represented exactly`);
};
export function dropsAtLeast(n1, d1, n2, d2, pp) {
  const [N1, D1, N2, D2] = [n1, d1, n2, d2].map(exactCount);
  if (D1 <= 0n || D2 <= 0n || N1 < 0n || N2 < 0n || N1 > D1 || N2 > D2) throw new Error(`COUNT_OUT_OF_RANGE: ${N1}/${D1}, ${N2}/${D2}`);
  if (!Number.isFinite(pp) || pp < 0) throw new Error(`THRESHOLD_INVALID: ${pp}`);
  const P = BigInt(Math.round(pp * 1000));
  return 100n * 1000n * (N1 * D2 - N2 * D1) >= P * D1 * D2;
}
export function holm(pValues) {
  const order = pValues.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), out = new Array(pValues.length);
  let running = 0;
  order.forEach(([p, i], k) => { running = Math.max(running, Math.min(1, p * (pValues.length - k))); out[i] = running; });
  return out;
}
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
export { addDays, daysBetween };
export function defaultWindows(db, length = 28) {
  const { last } = dataRange(db);
  return { cur: [addDays(last, -(length - 1)), last], base: [addDays(last, -(2 * length - 1)), addDays(last, -length)] };
}

                      
export const DIAG = Object.freeze({ alpha: 0.05, minDropPP: 1.0, minDenominator: 300, retryGapShare: 0.5, retryGapPerWeek: 50, challengeFailShare: 0.10, challengePerWeek: 200 });
const SCAN_METRICS = ['submission', 'approval', 'challenge'];

export function onset(db, seg, metric, from, to) {
  const s = dailySeries(db, segFilter(seg), from, to), m = METRICS[metric];
  if (s.length < 15) return null;
  let best = null;
  for (let k = 7; k <= s.length - 7; k++) {
    const sum = arr => arr.reduce((a, r) => [a[0] + r[m.num], a[1] + r[m.den]], [0, 0]);
    const [bn, bd] = sum(s.slice(0, k)), [an, ad] = sum(s.slice(k));
    if (!bd || !ad) continue;
    const drop = bn / bd - an / ad;
    if (!best || drop > best.drop) best = { day: s[k].day, drop };
  }
  return best && best.drop > 0 ? best.day : null;
}

                                                                                                               
function classify(db, f, win) {
  const onsetTxt = f.onset ? ` around ${f.onset}` : '';
  if (f.metric === 'submission') {
    const t = [totals(db, segFilter(f.segment), ...win.base), totals(db, segFilter(f.segment), ...win.cur)];
    const ap = compare(t[0].approved, t[0].reached, t[1].approved, t[1].reached);
    const ok = !ap || ap.p >= 0.05 || ap.diff > -0.01;
    if (!ok) return { type: 'UNCLASSIFIED', why: 'Submission and approval both fell; the loss is not isolated to one stage.', candidates: ['Several changes at once', 'Traffic mix change'], missing: ['Funnel events by stage', 'Release and campaign log'] };
    return { type: 'PRE_SUBMIT_LOSS', why: `Submission fell while issuer approval in the same segment held (${pctTxt(ap?.p1)} → ${pctTxt(ap?.p2)}): the loss happens before shoppers press Pay.`,
      candidates: ['A form or page change (for example a release)' + onsetTxt, 'A page error or slower load on this channel', 'A change in traffic mix (campaign, new shoppers)', 'A price or delivery-cost change'],
      missing: ['Release log' + onsetTxt, 'Field-level error and abandonment events', 'Page performance by channel', 'Traffic source mix before and after'] };
  }
  if (f.metric === 'approval') {
    const mix = p => { const m = declineMix(db, segFilter(f.segment), ...p), tot = m.reduce((a, r) => a + r.n, 0); return Object.fromEntries(m.map(r => [r.reason, tot ? r.n / tot : 0])); };
    const b = mix(win.base), c = mix(win.cur);
    const shifts = Object.keys({ ...b, ...c }).map(k => [k, (c[k] ?? 0) - (b[k] ?? 0)]).sort((x, y) => y[1] - x[1]);
    const [reason, shift] = shifts[0] ?? [null, 0];
    const grew = `Issuer approval fell; the decline reason that grew most is "${(reason ?? 'unknown').replace(/_/g, ' ')}" (+${(shift * 100).toFixed(1)} pp of declines).`;
    const byReason = {
      do_not_honour: { type: 'ISSUER_DNH', candidates: ['An issuer-side risk rule change', 'A routing or acquirer change', 'Missing or poor data in the authorisation (for example AVS or 3-D Secure data)'],
        missing: ['Raw PSP decline and advice codes', 'Routing and acquirer change log', 'Breakdown by BIN and issuer'] },
      insufficient_funds: { type: 'SOFT_DECLINES', candidates: ['Shopper funds timing (for example before payday)', 'A shift towards debit cards or new customers'], missing: ['Decline timing by day of month', 'Card type mix'] },
      suspected_fraud: { type: 'FRAUD_SIGNAL', candidates: ['An attack or fraud pattern', 'An issuer fraud-model change'], missing: ['Fraud and chargeback data', 'Velocity by card and device'] },
      sca_required: { type: 'SCA_SOFT_DECLINE', candidates: ['Exemptions requested where the issuer wants authentication', 'A 3-D Secure configuration change'], missing: ['Exemption flags per attempt', 'PSP 3-D Secure settings history'] },
    };
    const r = byReason[reason] ?? { type: 'UNCLASSIFIED', candidates: ['Not enough signal in decline reasons'], missing: ['Raw PSP decline codes'] };
    return { ...r, why: grew, mix: { base: b, cur: c } };
  }
  return { type: 'SCA_FRICTION', why: 'Fewer 3-D Secure challenges are completed, so more card payments stop at authentication.',
    candidates: ['A slower or failing authentication page', 'A change in challenge rate from the issuer'], missing: ['Challenge outcome by issuer', 'ACS response times'] };
}
const pctTxt = v => (v === undefined || v === null ? 'n/a' : (v * 100).toFixed(1) + '%');
const num0 = v => Math.round(v).toLocaleString('en-GB');

export function diagnose(db, win = defaultWindows(db), thresholds = {}) {
  const T = { ...DIAG, ...thresholds };
  const segments = [null];
  for (const [dim, d] of Object.entries(DIMS)) for (const v of Object.keys(d.values)) if (v !== 'n/a') segments.push({ dim, value: v });
  const curDays = daysBetween(...win.cur), tests = [];
  for (const metric of SCAN_METRICS) for (const seg of segments) {
    const m = METRICS[metric], b = totals(db, segFilter(seg), ...win.base), c = totals(db, segFilter(seg), ...win.cur);
    const t = compare(b[m.num], b[m.den], c[m.num], c[m.den]);
    if (t) tests.push({ metric, segment: seg, base: b, cur: c, test: t, lostPerWeek: Math.max(0, -t.diff) * c[m.den] * 7 / curDays });
  }
  const adj = holm(tests.map(t => t.test.p));
  let found = tests.map((t, i) => ({ ...t, pAdj: adj[i] }))
    .filter(t => { const m = METRICS[t.metric]; return t.pAdj < T.alpha && dropsAtLeast(t.base[m.num], t.base[m.den], t.cur[m.num], t.cur[m.den], T.minDropPP) && t.cur[m.den] >= T.minDenominator; });
                                                                                                             
  found.sort((a, b) => a.test.diff - b.test.diff);
  const kept = [];
  for (const f of found) {
    const explainer = kept.find(k => k.metric === f.metric && k.segment && (!f.segment || f.segment.dim !== k.segment.dim) && (() => {
      const m = METRICS[f.metric], ex = { dim: k.segment.dim, value: k.segment.value };
      const b = totals(db, segFilter(f.segment), ...win.base, ex), c = totals(db, segFilter(f.segment), ...win.cur, ex);
      const t = compare(b[m.num], b[m.den], c[m.num], c[m.den]);
      return !t || t.p >= 0.05 || !dropsAtLeast(b[m.num], b[m.den], c[m.num], c[m.den], T.minDropPP);
    })());
    if (explainer) { (explainer.explains ??= []).push(f.segment ? `${DIMS[f.segment.dim].label}: ${DIMS[f.segment.dim].values[f.segment.value]}` : 'All checkouts'); continue; }
    kept.push(f);
  }
  const findings = kept.map(f => ({ kind: 'change', ...f, onset: onset(db, f.segment, f.metric, win.base[0], win.cur[1]), ...classify(db, f, win) }));
                                              
  const all = totals(db, {}, ...win.cur), perWeek = x => x * 7 / curDays;
  if (all.soft_declined && all.soft_no_retry / all.soft_declined >= T.retryGapShare && perWeek(all.soft_no_retry) >= T.retryGapPerWeek) {
    findings.push({ kind: 'structural', metric: 'auth', segment: { dim: 'payment_method', value: 'card' }, cur: all, type: 'RETRY_GAP',
      share: all.soft_no_retry / all.soft_declined, lostPerWeek: perWeek(all.soft_no_retry), ifNoRetryPerWeek: perWeek(all.if_no_retry), unit: 'soft-declined checkouts never retried',
      why: `${(all.soft_no_retry / all.soft_declined * 100).toFixed(0)}% of checkouts that hit a soft decline never try again; ${num0(perWeek(all.if_no_retry))} a week of those were declined for insufficient funds.`,
      candidates: ['No retry flow after a decline', 'Shoppers not told why the payment failed'], missing: ['Decline message shown to shoppers', 'PSP retry advice codes'] });
  }
  if (all.ch && 1 - all.ch_done / all.ch >= T.challengeFailShare && perWeek(all.ch) >= T.challengePerWeek) {
    findings.push({ kind: 'structural', metric: 'challenge', segment: { dim: 'payment_method', value: 'card' }, cur: all, type: 'SCA_FRICTION',
      share: 1 - all.ch_done / all.ch, lostPerWeek: perWeek(all.ch - all.ch_done), unit: '3-D Secure challenges not completed (attempts)',
      why: `${((1 - all.ch_done / all.ch) * 100).toFixed(1)}% of 3-D Secure challenges are abandoned or failed.`,
      candidates: ['A slower or failing authentication page', 'One-time passcodes not reaching shoppers'], missing: ['Challenge outcome by issuer', 'ACS response times'] });
  }
  for (const f of findings) f.unit ??= 'checkouts lost (estimated)';
  findings.sort((a, b) => b.lostPerWeek - a.lostPerWeek);
  return { window: win, tested: tests.length, findings: findings.map((f, i) => ({ ...f, id: 'F-' + String(i + 1).padStart(2, '0') })) };
}

                                    
                                                                                                                            
                                                                                                                      
                                                                                                               
export const CHECK = Object.freeze({ alpha: 0.05, minDropPP: 1.0, power: 0.8, defaultDays: 28, minDays: 7, minCount: 10, smallDenominator: 300 });
export const CHECK_STATUS = Object.freeze(['worse', 'worse-below-threshold', 'improved', 'no-change', 'cannot-test']);
const Z_ALPHA = 1.959964, Z_POWER = 0.841621;                             
                                                                                                                                    
export const minDetectable = (p, d1, d2) => (Z_ALPHA + Z_POWER) * Math.sqrt(p * (1 - p) * (1 / d1 + 1 / d2));
                                                                                                                             
                                                            
export const isCalendarDate = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s ?? '')) return false; const t = Date.parse(s + 'T00:00:00Z'); return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s; };
const daysWithData = (db, from, to) => rows(db, 'SELECT COUNT(DISTINCT day) n FROM daily_cube WHERE day BETWEEN ? AND ?', [from, to])[0].n;

export function checkChange(db, { metric, segment = null, date, days = CHECK.defaultDays }) {
  const m = METRICS[metric];
  if (!m) throw new Error(`Unknown metric: ${metric}`);
  if (segment && DIMS[segment.dim]?.values[segment.value] === undefined) throw new Error('Unknown segment.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Enter the change date as 2026-10-14.');
  if (!isCalendarDate(date)) throw new Error(`${date} is not a date in the calendar.`);
  if (!Number.isSafeInteger(days) || days < 1) throw new Error('The window must be a whole number of days.');
  const range = dataRange(db), out = { kind: 'check', metric, segment, date, onset: date, requestedDays: days };
  const cannot = (reason, extra = {}) => ({ ...out, ...extra, status: 'cannot-test', reasons: [reason] });
  if (!range.first || date <= range.first || date > range.last) return cannot(`The change date must fall after the first day of data (${range.first}) and on or before the last (${range.last}).`, { days: 0 });
                                                                                                                           
  const used = Math.min(days, daysBetween(range.first, date) - 1, daysBetween(date, range.last));
  const window = { base: [addDays(date, -used), addDays(date, -1)], cur: [date, addDays(date, used - 1)] };
                                                                                                                    
  const dataDays = { base: daysWithData(db, ...window.base), cur: daysWithData(db, ...window.cur) };
  Object.assign(out, { days: used, shortened: used < days, window, dataDays, missingDays: { base: used - dataDays.base, cur: used - dataDays.cur } });
  if (Math.min(dataDays.base, dataDays.cur) < CHECK.minDays) return cannot(`Each side needs at least ${CHECK.minDays} days of data; this window has ${dataDays.base} before and ${dataDays.cur} after.`);
  const b = totals(db, segFilter(segment), ...window.base), c = totals(db, segFilter(segment), ...window.cur);
  const n1 = b[m.num] ?? 0, d1 = b[m.den] ?? 0, n2 = c[m.num] ?? 0, d2 = c[m.den] ?? 0;
  Object.assign(out, { base: b, cur: c, rates: { before: d1 ? n1 / d1 : null, after: d2 ? n2 / d2 : null }, small: d2 < CHECK.smallDenominator });
                                                                                           
  if (!d1 || !d2) return cannot(`There is no ${m.label.toLowerCase()} denominator ${!d1 ? 'before' : 'after'} the date in this segment.`);
  if (n1 + n2 === 0 || n1 + n2 === d1 + d2) return cannot(`Every case on both sides has the same outcome, so there is no variation to test.`);
  if (Math.min(n1, d1 - n1, n2, d2 - n2) < CHECK.minCount) return cannot(`Fewer than ${CHECK.minCount} successes or failures on one side; the test's approximation is not reliable.`);
  const test = compare(n1, d1, n2, d2), sig = test.p < CHECK.alpha;
  const status = !sig ? 'no-change' : test.diff > 0 ? 'improved' : dropsAtLeast(n1, d1, n2, d2, CHECK.minDropPP) ? 'worse' : 'worse-below-threshold';
  Object.assign(out, { test, status, reasons: [], mde: minDetectable(test.p1, d1, d2), lostPerWeek: Math.max(0, -test.diff) * d2 * 7 / dataDays.cur, unit: 'checkouts lost (estimated)' });
  if (status !== 'worse') return out;
                                                                                                                   
  if (metric === 'auth') return { ...out, type: 'UNCLASSIFIED', why: `${m.label} was lower after ${date} than before. This product has no problem-type rule for this metric, so it shows the evidence only.`,
    candidates: ['Submission, issuer approval and 3-D Secure completion all feed this metric; check each of them for the same dates'], missing: ['Funnel events by stage', 'Release and campaign log'] };
  return { ...out, ...classify(db, { metric, segment, onset: date }, window) };
}

                         
                                                                                                            
                                                                                                                 
export const RULES = Object.freeze([
  { id: 'R-FF1', types: ['PRE_SUBMIT_LOSS'], title: 'Simplify the checkout form', how: 'Fewer fields and a single column reduce typing and errors before Pay.', metric: 'submission', recover: [0.25, 0.75], effort: 'M',
    when: 'Loss sits before Pay and field errors or long forms are a plausible cause', needs: 'Field-level error events to confirm', owner: 'Merchant (checkout team)', risk: 'Dropping fields the acquirer or fraud tools need', notFor: 'Losses after submission' },
  { id: 'R-FF2', types: ['PRE_SUBMIT_LOSS'], title: 'Add address lookup', how: 'A postcode lookup replaces four typed address fields.', metric: 'submission', recover: [0.15, 0.5], effort: 'S',
    when: 'Address entry shows errors or slow completion', needs: 'Address field timings and errors', owner: 'Merchant, with an address-data provider', risk: 'Lookup outages; wrong addresses', notFor: 'Digital goods without an address step' },
  { id: 'R-FF3', types: ['PRE_SUBMIT_LOSS'], title: 'Check releases around the onset; roll back if one is confirmed', how: 'If the release log shows a change around the onset date, reverting it should win back most of the loss.', metric: 'submission', recover: [0.5, 1.0], effort: 'S', onsetOnly: true,
    when: 'A release is confirmed around the onset date', needs: 'Release log — this product does not have it', owner: 'Merchant (engineering)', risk: 'Rolling back an unrelated change', notFor: 'Onsets with no matching release' },
  { id: 'R-RT1', types: ['SOFT_DECLINES', 'RETRY_GAP'], title: 'Smart retry after an insufficient-funds decline', how: 'Retry once, later, when the PSP advice code allows it.', metric: 'auth', recover: [0.2, 0.5], effort: 'M', base: 'insufficientFunds',
    when: 'Insufficient-funds declines with a retry-allowed advice code', needs: 'PSP advice codes; scheme retry limits', owner: 'Merchant with the PSP', risk: 'Scheme fees and issuer distrust from excessive retries', notFor: '"Do not honour" and other hard or unknown declines' },
  { id: 'R-RT2', types: ['SOFT_DECLINES', 'RETRY_GAP', 'ISSUER_DNH'], title: 'Offer another payment method after a decline', how: 'Show wallets and Pay by Bank straight after a card decline.', metric: 'auth', recover: [0.1, 0.3], effort: 'S',
    when: 'Card declines where shoppers have no next step', needs: 'Which alternative methods are enabled', owner: 'Merchant', risk: 'Higher processing cost on some methods', notFor: 'Fraud-related declines' },
  { id: 'R-IS1', types: ['ISSUER_DNH'], title: 'Ask the PSP and issuers why "do not honour" grew', how: 'Get raw decline and advice codes, check routing and authorisation data quality. Investigation, not an experiment.', metric: null, effort: '—',
    when: '"Do not honour" rose for a segment', needs: 'Raw PSP codes, BIN breakdown, routing log', owner: 'Merchant with the PSP; the issuer decides', risk: '—', notFor: '—' },
  { id: 'R-SC1', types: ['SCA_FRICTION'], title: 'Request TRA exemptions for low-risk payments', how: 'Ask for a transaction-risk-analysis exemption below a value threshold so fewer shoppers see a challenge.', metric: 'auth', recover: [0.2, 0.5], effort: 'M',
    when: 'The PSP and acquirer support TRA and their fraud rate allows it', needs: 'Acquirer fraud rate and TRA thresholds', owner: 'PSP and acquirer; the issuer can still demand a challenge', risk: 'Liability shift to the merchant; more soft declines', notFor: 'Acquirers above the TRA fraud-rate limit' },
  { id: 'R-SC2', types: ['SCA_FRICTION', 'SCA_SOFT_DECLINE'], title: 'Improve the challenge experience', how: 'In-app or biometric authentication instead of one-time passcodes.', metric: 'auth', recover: [0.1, 0.4], effort: 'L',
    when: 'Challenges are abandoned rather than failed', needs: 'Challenge outcome by issuer and device', owner: 'Mostly issuers and ACS providers; the merchant controls the frame and messaging', risk: 'Limited merchant control', notFor: 'Issuer-side failures' },
  { id: 'R-FR1', types: ['FRAUD_SIGNAL'], title: 'Review fraud rules with the risk team', how: 'Investigate first; this is not a conversion experiment.', metric: null, effort: '—',
    when: 'Fraud-related declines rose', needs: 'Fraud and chargeback data', owner: 'Merchant risk team', risk: '—', notFor: '—' },
]);
export const TYPE_LABEL = Object.freeze({ PRE_SUBMIT_LOSS: 'Loss before Pay', SOFT_DECLINES: 'Rising insufficient-funds declines', ISSUER_DNH: 'Rising "do not honour" declines',
  FRAUD_SIGNAL: 'Rising fraud-related declines', SCA_SOFT_DECLINE: 'SCA-required declines', SCA_FRICTION: '3-D Secure challenges not completed', RETRY_GAP: 'Soft declines never retried', UNCLASSIFIED: 'Unclassified change' });
                                                                                                                              
                                                                                                                         
export const INVESTIGATE_ONLY = new Set(['R-SC1']);
export const actionability = r => (!r.metric || INVESTIGATE_ONLY.has(r.id) ? 'Investigate only' : 'Can test now');
export const optionsFor = f => RULES.filter(r => r.types.includes(f.type) && (!r.onsetOnly || f.onset));

                            
export function estimate(db, finding, rule, win, assumptions = {}) {
  if (!rule.metric) return { estimable: false, reason: 'Investigation only; no conversion estimate.' };
  const days = daysBetween(...win.cur), t = totals(db, segFilter(finding.segment), ...win.cur);
  const weekly = t.started * 7 / days, aov = t.approved ? t.approved_amount / t.approved : 0;
  const reachRate = t.submitted ? t.reached / t.submitted : 0, approvalRate = t.reached ? t.approved / t.reached : 0;
                                                                                                   
  const recover = assumptions.recover ?? rule.recover, lost = rule.base === 'insufficientFunds' && finding.ifNoRetryPerWeek !== undefined ? finding.ifNoRetryPerWeek : finding.lostPerWeek ?? 0;
  const recovered = recover.map(x => x * lost);
  const upliftPP = recovered.map(x => weekly ? x / weekly * 100 : 0);
                                                                                                                                
  const toPayments = rule.metric === 'submission' ? reachRate * approvalRate : 1;
  const base = rule.metric === 'submission' ? t.submitted / t.started : t.approved / t.started;
  const mde = assumptions.mdePP ?? +((upliftPP[0] + upliftPP[1]) / 2).toFixed(2);
  let perArm = null, testDays = null;
  if (mde > 0 && base + mde / 100 < 1) { perArm = requiredPerArm(+base.toFixed(4), mde); testDays = Math.ceil(2 * perArm / (t.started / days)); }
  const valuePerWeek = recovered.map(x => x * toPayments * aov);                                                                                
  return { estimable: true, weekly, base, recover, lostBase: lost, recovered, upliftPP, valuePerWeek, valueMid: (valuePerWeek[0] + valuePerWeek[1]) / 2, aov, reachRate, approvalRate,
    mde, perArm, testDays, dailyEligible: t.started / days };
}
