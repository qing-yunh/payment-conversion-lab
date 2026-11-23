                                                                        
                                                                                         
export const SAMPLE_GENERATOR = 'pcl-sample-history-1';
const DAY_MS = 86_400_000;

export const SAMPLE_DEFAULTS = Object.freeze({
  seed: 'pcl-sample-1', start: '2026-08-10', days: 90, dailyCheckouts: 700,
  formRelease: '2026-10-14',                                                       
  eeaIssuerChange: '2026-10-20',                                                    
  mobileDrop: 0.042,                                                                             
  eeaApproval: 0.80,                                                                          
});

export function rng(seedText) {
  let h = 2166136261;
  for (const c of seedText) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let a = h;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const pick = (r, table) => { let x = r(); for (const [k, w] of table) { if ((x -= w) < 0) return k; } return table.at(-1)[0]; };
const WEEKDAY = [1.05, 0.95, 0.94, 0.96, 1.0, 1.06, 1.1];
const BASE_SUBMIT = { web_desktop: 0.885, web_mobile: 0.868, app: 0.892 };
const RELEASE_DROP = { web_desktop: 0.006, web_mobile: 0.042, app: 0 };

                                                                                                     
export function attemptOutcome(r, { method, amount, issuerRegion, attemptNo, eeaShift, eeaApproval = 0.80 }) {
  const sca = method === 'card' ? (amount < 10000 && r() < 0.35 ? 'exemption' : pick(r, [['frictionless', 0.72], ['challenge', 0.28]]))
    : method === 'wallet' ? 'frictionless' : 'not_applicable';
  const challenge = sca === 'challenge' ? pick(r, [['completed', 0.86], ['abandoned', 0.1], ['failed', 0.04]]) : null;
  let auth = 'not_reached', reason = null;
  if (sca !== 'challenge' || challenge === 'completed') {
    const approveP = attemptNo === 1 ? (eeaShift && issuerRegion === 'EEA' ? eeaApproval : 0.905) : 0.7;
    const x = r();
    auth = x < approveP ? 'approved' : x < approveP + (1 - approveP) * 0.94 ? 'declined' : x < approveP + (1 - approveP) * 0.97 ? 'unknown' : 'error';
    if (auth === 'declined') reason = eeaShift && issuerRegion === 'EEA' && r() < 0.6 ? 'do_not_honour'
      : pick(r, [['insufficient_funds', 0.38], ['do_not_honour', 0.3], ['suspected_fraud', 0.12], ['sca_required', 0.12], ['card_expired', 0.08]]);
  }
  return { sca, challenge, auth, reason };
}

export function checkoutProfile(r) {
  const channel = pick(r, [['web_mobile', 0.52], ['web_desktop', 0.38], ['app', 0.10]]);
  const method = pick(r, channel === 'app' ? [['wallet', 0.5], ['card', 0.45], ['pay_by_bank', 0.05]] : [['card', 0.72], ['wallet', 0.2], ['pay_by_bank', 0.08]]);
  const card = method === 'card';
  return { channel, method, scheme: card ? pick(r, [['visa', 0.62], ['mastercard', 0.33], ['amex', 0.05]]) : null,
    issuerRegion: card ? pick(r, [['UK', 0.86], ['EEA', 0.10], ['RoW', 0.04]]) : null,
    customer: r() < 0.35 ? 'new' : 'returning', amount: Math.round(Math.exp(3.4 + r() * 1.9) * 100) };
}

export function generateSample(options = {}) {
  const cfg = { ...SAMPLE_DEFAULTS, ...options };
  if (!Number.isSafeInteger(cfg.days) || cfg.days < 14 || cfg.days > 366) throw new Error('Days must be between 14 and 366.');
  if (!Number.isSafeInteger(cfg.dailyCheckouts) || cfg.dailyCheckouts < 50 || cfg.dailyCheckouts > 20_000) throw new Error('Daily checkouts must be between 50 and 20,000.');
  const r = rng(cfg.seed), start = Date.parse(cfg.start + 'T00:00:00Z');
  const release = Date.parse(cfg.formRelease + 'T00:00:00Z'), eea = Date.parse(cfg.eeaIssuerChange + 'T00:00:00Z');
  const checkouts = [], attempts = [];
  let seq = 0;
  for (let d = 0; d < cfg.days; d++) {
    const dayStart = start + d * DAY_MS;
    const n = Math.round(cfg.dailyCheckouts * WEEKDAY[new Date(dayStart).getUTCDay()] * (0.95 + r() * 0.1));
    for (let i = 0; i < n; i++) {
      const id = 'CO-' + String(++seq).padStart(7, '0');
      const hour = Math.min(23.999, Math.max(0, 7 + 15 * Math.sqrt(r()) + (r() - 0.5) * 3));
      const t0 = dayStart + Math.floor(hour * 3_600_000), p = checkoutProfile(r);
      checkouts.push([id, t0, p.channel, p.method, p.scheme, p.issuerRegion, p.customer, p.amount, 'GBP', 1]);
      const drop = t0 >= release ? (p.channel === 'web_mobile' ? cfg.mobileDrop : RELEASE_DROP[p.channel]) : 0;
      if (r() >= BASE_SUBMIT[p.channel] - drop) continue;
      let t = t0 + 60_000 + Math.floor(r() * 19 * 60_000);
      for (let a = 1; a <= 2; a++) {
        const o = attemptOutcome(r, { method: p.method, amount: p.amount, issuerRegion: p.issuerRegion, attemptNo: a, eeaShift: t0 >= eea, eeaApproval: cfg.eeaApproval });
        attempts.push([`${id}-A${a}`, id, a, t, o.sca, o.challenge, o.auth, o.reason, o.auth === 'unknown' ? null : t + 1_500 + Math.floor(r() * 4_000)]);
        if (o.auth === 'approved' || o.auth === 'unknown' || r() > 0.35) break;
        t += 60_000 + Math.floor(r() * 4 * 60_000);
      }
    }
  }
  return { dataset: { dataset_id: 'SAMPLE-HISTORY-' + cfg.days + 'D', version: 1, source: 'Synthetic', generator: SAMPLE_GENERATOR, seed: cfg.seed,
    coverage_start_ms: start, coverage_through_ms: start + cfg.days * DAY_MS - 1, coverage_complete: 1 }, checkouts, attempts, assignments: [], config: cfg };
}
