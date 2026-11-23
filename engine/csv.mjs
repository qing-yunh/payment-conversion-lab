                                                                                         
export const REQUIRED = ['record_id', 'checkout_id', 'experiment_id', 'variant', 'eligible', 'assigned_at', 'outcome_known'];
                                                             
export const OPTIONAL = ['exposed_at', 'submitted_at', 'auth_result', 'auth_at', 'channel', 'payment_method', 'amount_minor'];
export const COLUMNS = [...REQUIRED, ...OPTIONAL];
                                                              
export const LIMITS = Object.freeze({ maxBytes: 100 * 1024 * 1024, maxRows: 500_000, maxErrorsShown: 20 });
const ALIASES = { arm: 'variant', group: 'variant', order_id: 'checkout_id', session_id: 'checkout_id', id: 'record_id', row_id: 'record_id',
  assigned: 'assigned_at', exposure_at: 'exposed_at', submit_at: 'submitted_at', submission_at: 'submitted_at', auth_status: 'auth_result', amount: 'amount_minor',
  auth_time: 'auth_at', authorised_at: 'auth_at', authorized_at: 'auth_at', auth_result_at: 'auth_at' };

                                                                                      
export function parseCsv(text) {
  const out = []; let row = [], field = '', i = 0, quoted = false;
  if (text.charCodeAt(0) === 0xFEFF) i = 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.length > 1 || row[0] !== '') out.push(row); row = []; }
    else field += c;
  }
  if (quoted) throw new Error('The file ends inside a quoted field. Check for an unmatched quote.');
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  return out;
}

function luhn(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let d = digits.charCodeAt(i) - 48; if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; }
  return sum % 10 === 0;
}
                                                                                                                                                         
export function findCardNumber(table) {
  for (let r = 0; r < table.length; r++) for (let c = 0; c < table[r].length; c++) {
    for (const m of table[r][c].matchAll(/(?:\d[ -]?){13,19}/g)) {
      const digits = m[0].replace(/[ -]/g, '');
      if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits)) return { row: r + 1, column: c + 1 };
    }
  }
  return null;
}

export function suggestMapping(header) {
  const map = {};
  header.forEach((h, i) => { const k = h.trim().toLowerCase().replace(/[\s-]+/g, '_'); const target = COLUMNS.includes(k) ? k : ALIASES[k]; if (target && map[target] === undefined) map[target] = i; });
  return map;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
                                                                                                                        
export function strictIso(v) {
  if (!ISO.test(v)) return null;
  const ms = Date.parse(v);
  if (!Number.isFinite(ms)) return null;
  const [main, frac = ''] = v.slice(0, -1).split('.');
  return new Date(ms).toISOString() === `${main}.${frac.padEnd(3, '0')}Z` ? new Date(ms).toISOString() : null;
}
const bool = v => { const s = v.trim().toLowerCase(); return s === 'true' || s === '1' ? true : s === 'false' || s === '0' ? false : null; };

                                                                                                      
export function validateRows(table, mapping, experimentId) {
  const errors = [], rows = [], seen = new Set();
  const missing = REQUIRED.filter(k => mapping[k] === undefined);
  if (missing.length) return { rows, errors: [{ line: 1, message: `Missing required columns: ${missing.join(', ')}.` }], stats: null };
  const get = (r, k) => (mapping[k] === undefined ? '' : (r[mapping[k]] ?? '').trim());
  const err = (line, message) => { errors.push({ line, message }); };
  for (let i = 1; i < table.length; i++) {
    const r = table[i], line = i + 1;
    const rec = { record_id: get(r, 'record_id'), checkout_id: get(r, 'checkout_id'), experiment_id: get(r, 'experiment_id'), variant: get(r, 'variant').toUpperCase() };
    if (!rec.record_id || !rec.checkout_id) { err(line, 'record_id and checkout_id are required.'); continue; }
    if (seen.has(rec.record_id)) err(line, `Duplicate record_id "${rec.record_id}".`); seen.add(rec.record_id);
    if (rec.experiment_id !== experimentId) err(line, `experiment_id is "${rec.experiment_id}", expected "${experimentId}".`);
    if (!['A', 'B'].includes(rec.variant)) err(line, 'variant must be A or B.');
    const eligible = bool(get(r, 'eligible')), known = bool(get(r, 'outcome_known'));
    if (eligible === null) err(line, 'eligible must be true or false.');
    if (known === null) err(line, 'outcome_known must be true or false.');
    const t = {};
    for (const k of ['assigned_at', 'exposed_at', 'submitted_at', 'auth_at']) {
      const v = get(r, k);
      if (!v) { if (k === 'assigned_at') err(line, 'assigned_at is required.'); t[k] = null; continue; }
      const iso = strictIso(v);
      if (!iso) { err(line, `${k} "${v}" is not a valid ISO 8601 UTC time such as 2026-11-09T10:15:00Z.`); t[k] = null; continue; }
      t[k] = iso;
    }
    const auth = get(r, 'auth_result').toLowerCase() || null;
                                                                                                                                      
    if (auth && !['approved', 'declined', 'error', 'unknown', 'not_reached'].includes(auth)) err(line, 'auth_result must be approved, declined, error, unknown or not_reached.');
                                                                                                                              
    if (t.auth_at && !auth) err(line, 'auth_at needs an auth_result in the same row.');
    if (t.auth_at && t.assigned_at && t.auth_at < t.assigned_at) err(line, 'auth_at is earlier than assigned_at.');
    if (t.auth_at && t.submitted_at && t.auth_at < t.submitted_at) err(line, 'auth_at is earlier than submitted_at in the same row.');
    const amount = get(r, 'amount_minor');
    if (amount && !/^\d+$/.test(amount)) err(line, 'amount_minor must be a whole number of pence.');
    rows.push({ ...rec, eligible, outcome_known: known, ...t, auth_result: auth, channel: get(r, 'channel') || null, payment_method: get(r, 'payment_method') || null, amount_minor: amount ? Number(amount) : null });
    if (errors.length > 1000) break;
  }
  let lastTs = 0;
  for (const x of rows) for (const k of ['assigned_at', 'exposed_at', 'submitted_at', 'auth_at']) if (x[k]) { const t = Date.parse(x[k]); if (t > lastTs) lastTs = t; }
  return { rows, errors, stats: { rows: rows.length, checkouts: new Set(rows.map(x => x.checkout_id)).size, lastEvent: lastTs ? new Date(lastTs).toISOString() : null } };
}

export function toCsv(rows) {
  const q = v => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return COLUMNS.join(',') + '\n' + rows.map(r => COLUMNS.map(k => q(r[k])).join(',')).join('\n') + '\n';
}
