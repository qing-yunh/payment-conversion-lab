                                                                                                                     
import { evidenceCurrent, fingerprint, freezePlan, isLegacyPlan } from '../domain/checkout-plan.mjs';
import { auditEvidence } from '../domain/checkout-evidence.mjs';
import { ANALYSIS_RULES_VERSION, analyse, conclusion } from '../engine/results.mjs';
import { insertPlan, insertReview, insertDecision, experimentState } from './db.mjs';
import { rows, METRICS, DIMS, RULES } from '../engine/analytics.mjs';

const nextId = (db, table, col, prefix, width) => {
  const n = rows(db, `SELECT COUNT(*) n FROM ${table}`)[0].n + 1;
  return prefix + String(n).padStart(width, '0');
};
const log = (db, action, type, id, detail) => db.run('INSERT INTO activity (at_ms, actor, action, object_type, object_id, detail) VALUES (?, ?, ?, ?, ?, ?)', [Date.now(), 'You', action, type, id, detail ?? null]);
export const segLabel = seg => (seg ? `${DIMS[seg.dim].values[seg.value]}` : 'All checkouts');

                                                                                                                              
                                                                                                                      
export const dataVersion = db => { const d = rows(db, "SELECT dataset_id, version FROM dataset WHERE dataset_id NOT LIKE 'RESULTS-%' ORDER BY ds LIMIT 1")[0]; return d ? `${d.dataset_id} v${d.version}` : null; };
export const sameObservation = (opened, window, version) => JSON.stringify([opened.window?.cur, opened.window?.base]) === JSON.stringify([window?.cur, window?.base])
  && (opened.dataVersion === undefined || opened.dataVersion === version);                                                                   
export function createOpportunity(db, finding) {
  const existing = opportunityFor(db, finding);
  if (existing) return existing;
  finding = { ...finding, dataVersion: dataVersion(db) };
  const id = nextId(db, 'opportunity', 'opportunity_id', 'P-', 2), m = METRICS[finding.metric], check = finding.kind === 'check';
                                                                         
  const title = finding.kind === 'structural' ? finding.why.replace(/\.$/, '')
    : check ? `Checked: ${m.label.toLowerCase()} ${(Math.abs(finding.test.diff) * 100).toFixed(1)} pp lower on ${segLabel(finding.segment).toLowerCase()} after ${finding.date}`
    : `${m.label} fell ${(Math.abs(finding.test.diff) * 100).toFixed(1)} pp on ${segLabel(finding.segment).toLowerCase()}`;
  db.run(`INSERT INTO opportunity VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Investigating', ?)`, [id, title, finding.metric, JSON.stringify(finding.segment),
    finding.window?.base?.join('..') ?? '', finding.window?.cur?.join('..') ?? '', finding.test?.p1 ?? null, finding.test?.p2 ?? null, check ? 'Manual' : 'Monitor alert', Date.now()]);
  db.run('INSERT INTO opportunity_finding VALUES (?, ?)', [id, JSON.stringify({ ...finding, key: findingKey(finding) })]);
  log(db, 'Opened opportunity', 'opportunity', id, check ? `check of ${finding.date}` : finding.id);
  return id;
}
export const findingKey = f => `${f.kind}|${f.metric}|${f.segment ? f.segment.dim + '=' + f.segment.value : 'all'}|${f.type}`;
                                                                                                   
export const problemKey = f => `${f.metric}|${f.segment ? f.segment.dim + '=' + f.segment.value : 'all'}|${f.type}`;
                                                                                                                                 
                                                                                                          
const family = kind => (kind === 'check' ? 'change' : kind);
                                                                                             
                                                                                                                        
                                                                                             
export function opportunityFor(db, f) {
  const opened = rows(db, 'SELECT opportunity_id, finding_json FROM opportunity_finding ORDER BY rowid').map(o => ({ id: o.opportunity_id, f: JSON.parse(o.finding_json) }));
  return opened.find(o => family(o.f.kind) === family(f.kind) && problemKey(o.f) === problemKey(f))?.id ?? null;
}
                                                                                              
export const CHECK_ACTION = 'Checked a specific change';
                                                                                                                              
                                                                                                  
export function recordCheck(db, r) {
  const m = METRICS[r.metric], side = (label, w, t) => (w ? `${label} ${w[0]}..${w[1]}: ${t ? `${t[m.num] ?? 0} of ${t[m.den] ?? 0}` : 'not read'}` : `${label}: no window`);
  const detail = [m.label, segLabel(r.segment), `change date ${r.date}`, `asked ${r.requestedDays} days, used ${r.days ?? 0}`,
    side('before', r.window?.base, r.base), side('after', r.window?.cur, r.cur), `data ${dataVersion(db) ?? 'version not recorded'}`,
    r.test ? `p ${r.test.p < 0.001 ? '< 0.001' : r.test.p.toFixed(4)}` : 'no p-value', r.status + (r.reasons?.length ? ` (${r.reasons[0]})` : '')];
  log(db, CHECK_ACTION, 'check', r.date, detail.join(' · '));
}
export const checkCount = db => rows(db, 'SELECT COUNT(*) n FROM activity WHERE action = ?', [CHECK_ACTION])[0].n;
export const opportunities = db => rows(db, `SELECT o.*, f.finding_json, (SELECT COUNT(*) FROM hypothesis h WHERE h.opportunity_id = o.opportunity_id) hyps FROM opportunity o JOIN opportunity_finding f USING (opportunity_id) ORDER BY o.created_ms`)
  .map(o => ({ ...o, finding: JSON.parse(o.finding_json) }));

export function createExperiment(db, opportunityId, rule, segment) {
  const h = nextId(db, 'hypothesis', 'hypothesis_id', 'H-', 2), e = nextId(db, 'experiment', 'experiment_id', 'EXP-', 3), now = Date.now();
  db.exec('BEGIN');
  try {
    db.run(`INSERT INTO hypothesis VALUES (?, ?, ?, ?, 'Selected', ?)`, [h, opportunityId, `${rule.title} will raise ${METRICS[rule.metric].label.toLowerCase()} for ${segLabel(segment).toLowerCase()}.`, rule.how, now]);
    db.run('INSERT INTO experiment VALUES (?, ?, ?, ?, ?)', [e, h, rule.title, rule.metric === 'submission' ? 'PAYMENT_SUBMISSION_30M_ITT' : 'PAYMENT_AUTH_APPROVAL_60M_ITT', now]);
                                                                                                                        
                                                                                                                                   
    const guardrails = rule.metric === 'auth' ? [
      { id: 'submission', label: 'Payment submission', metric: 'submission', tolerance: 0.5, unit: 'pp' },
      { id: 'aov', label: 'Average approved order', metric: 'aov', tolerance: 2, unit: '£' },
      { id: 'chargebacks', label: 'Chargebacks and disputes', metric: null, tolerance: null, unit: null, kind: 'risk',
        noDataReason: 'Unverified risk item: chargebacks arrive 60–120 days later, so this data cannot check them. A required check in any real experiment.' },
    ] : [
      { id: 'approval', label: 'Issuer approval', metric: 'approval', tolerance: 1.0, unit: 'pp' },
      { id: 'auth', label: 'Authorisation conversion', metric: 'auth', tolerance: 0.5, unit: 'pp' },
      { id: 'aov', label: 'Average approved order', metric: 'aov', tolerance: 2, unit: '£' },
      { id: 'chargebacks', label: 'Chargebacks and disputes', metric: null, tolerance: null, unit: null, noDataReason: 'Chargebacks arrive 60–120 days later; carried into the real experiment as a required check.' },
    ];
    db.run('INSERT INTO experiment_revision VALUES (?, 1, ?, ?, ?, ?, ?)', [e, rule.id, JSON.stringify(segment), JSON.stringify(guardrails), 'Initial design', now]);
    db.run(`UPDATE opportunity SET status = 'In experiment' WHERE opportunity_id = ?`, [opportunityId]);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  log(db, 'Created experiment', 'experiment', e, rule.id);
  return e;
}

export function experiments(db) {
  return rows(db, `SELECT ex.*, h.opportunity_id, h.statement, r.treatment rule_id, r.eligibility_version segment_json, r.guardrails_json FROM experiment ex
    JOIN hypothesis h USING (hypothesis_id) JOIN experiment_revision r ON r.experiment_id = ex.experiment_id AND r.revision = (SELECT MAX(revision) FROM experiment_revision x WHERE x.experiment_id = ex.experiment_id)
    ORDER BY ex.created_ms`).map(x => ({ ...x, rule: RULES.find(r => r.id === x.rule_id), segment: JSON.parse(x.segment_json), guardrails: JSON.parse(x.guardrails_json), state: experimentState(db, x.experiment_id) }));
}
export const plans = (db, id) => rows(db, 'SELECT * FROM plan WHERE experiment_id = ? ORDER BY plan_version', [id]).map(p => JSON.parse(p.plan_json));

                                                                                                    
                                                                                                                                        
export async function bindingOf(db, experimentId) {
  const x = rows(db, `SELECT ex.primary_metric_id, h.hypothesis_id, h.statement, h.opportunity_id, r.revision, r.treatment, r.eligibility_version, r.guardrails_json
    FROM experiment ex JOIN hypothesis h USING (hypothesis_id) JOIN experiment_revision r ON r.experiment_id = ex.experiment_id
    AND r.revision = (SELECT MAX(revision) FROM experiment_revision x WHERE x.experiment_id = ex.experiment_id) WHERE ex.experiment_id = ?`, [experimentId])[0];
  if (!x) return null;
  const finding = rows(db, 'SELECT finding_json FROM opportunity_finding WHERE opportunity_id = ?', [x.opportunity_id])[0];
  return { experimentId, experimentRevision: x.revision, metricId: x.primary_metric_id, problemId: x.opportunity_id,
    problemFingerprint: await fingerprint(finding ? JSON.parse(finding.finding_json) : null), hypothesisId: x.hypothesis_id, hypothesisStatement: x.statement,
    treatment: x.treatment, segment: JSON.parse(x.eligibility_version), guardrailsFingerprint: await fingerprint(JSON.parse(x.guardrails_json)) };
}
                                                                                                                       
export async function freeze(db, experimentId, { baselineRate, mdePP, enrollmentStart, enrollmentEnd, frozenAt = new Date().toISOString() }) {
  const version = rows(db, 'SELECT COUNT(*) n FROM plan WHERE experiment_id = ?', [experimentId])[0].n + 1;
  const { experimentRevision, metricId, experimentId: _id, ...binding } = await bindingOf(db, experimentId);
  const plan = await freezePlan({ experimentId, experimentRevision, planVersion: version, metricId, binding, baselineRate, mdePP, enrollmentStart, enrollmentEnd, frozenAt });
  insertPlan(db, plan);
  log(db, 'Froze plan', 'plan', `${experimentId} v${version}`, plan.fingerprint);
  return plan;
}

export async function importResults(db, { experimentId, plan, rows: data, fileName, coverageThrough, coverageComplete }) {
  refuseLegacyPlan(plan);
  const version = rows(db, 'SELECT COUNT(*) n FROM result_import WHERE experiment_id = ?', [experimentId])[0].n + 1;
  const datasetId = `RESULTS-${experimentId}`, cov = Date.parse(coverageThrough);
  let first = Infinity; for (const r of data) { const t = Date.parse(r.assigned_at); if (t < first) first = t; }                                
  const importFingerprint = await importDigest(data);                                                        
  db.exec('BEGIN');
  let ds;
  try {
    db.run(`INSERT INTO dataset (dataset_id, version, source, generator, seed, coverage_start_ms, coverage_through_ms, coverage_complete, created_ms) VALUES (?, ?, 'Synthetic', ?, '-', ?, ?, ?, ?)`,
      [datasetId, version, 'import:' + fileName, first, cov, coverageComplete ? 1 : 0, Date.now()]);
    ds = rows(db, 'SELECT last_insert_rowid() ds')[0].ds;
    db.run('INSERT INTO result_import VALUES (?, ?, ?, ?, ?, ?, ?)', [ds, experimentId, fileName, data.length, Date.now(), importFingerprint, ANALYSIS_RULES_VERSION]);
    const stmt = db.prepare(INSERT_ROW);
    try { for (const r of data) stmt.run(rowParams(ds, r)); } finally { stmt.free(); }
    storeAuthTimes(db, ds, data);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  const ev = await auditRows({ plan, rows: data, coverageThrough, coverageComplete, datasetId, version, evidenceId: `EV-${experimentId.slice(4)}-${version}` });
  const seq = (rows(db, 'SELECT MAX(m) m FROM (SELECT MAX(seq) m FROM evidence UNION ALL SELECT MAX(seq) FROM risk_review UNION ALL SELECT MAX(seq) FROM decision)')[0].m ?? 0) + 1;
  db.run('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ev.id, seq, experimentId, plan.experimentRevision, plan.planVersion, plan.fingerprint, ds,
    ev.binding.datasetFingerprint, cov, ev.evidenceStatus, JSON.stringify(ev), Date.now()]);
  log(db, 'Imported results', 'evidence', ev.id, `${data.length} rows · ${ev.evidenceStatus}`);
  return ev;
}
const INSERT_ROW = 'INSERT INTO result_row VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
                                                                                                                              
                                                                      
function storeAuthTimes(db, ds, data) {
  const stmt = db.prepare('INSERT INTO result_auth VALUES (?, ?, ?)');
  try { for (const r of data) if (r.auth_at) stmt.run([ds, r.record_id, Date.parse(r.auth_at)]); } finally { stmt.free(); }
}
                                                                                                                
function refuseLegacyPlan(plan) {
  if (isLegacyPlan(plan)) throw new Error(`PLAN_V1_REFREEZE_REQUIRED: plan v${plan.planVersion} of ${plan.experimentId} was frozen before plans recorded what they test. Freeze a new plan to import results.`);
}
const rowParams = (ds, r) => [ds, r.record_id, r.checkout_id, r.experiment_id, r.variant, r.eligible ? 1 : 0, Date.parse(r.assigned_at), r.exposed_at ? Date.parse(r.exposed_at) : null,
  r.submitted_at ? Date.parse(r.submitted_at) : null, r.auth_result, r.outcome_known ? 1 : 0, r.channel, r.payment_method, r.amount_minor];
const fmt = n => Number(n).toLocaleString('en-GB');

                                                                                                                         
export function nextImportIds(db, experimentId) {
  const version = rows(db, 'SELECT COUNT(*) n FROM result_import WHERE experiment_id = ?', [experimentId])[0].n + 1;
  return { version, datasetId: `RESULTS-${experimentId}`, evidenceId: `EV-${experimentId.slice(4)}-${version}` };
}
   
                                                                                                                         
                                                                                                         
                                                                                                                                   
   
export async function importPrepared(db, { experimentId, plan, fileName, coverageThrough, coverageComplete, version, datasetId, prepared, batches, onProgress = () => {} }) {
  refuseLegacyPlan(plan);
  const cov = Date.parse(coverageThrough), ev = prepared.evidence;
  db.exec('BEGIN');
  try {
    db.run(`INSERT INTO dataset (dataset_id, version, source, generator, seed, coverage_start_ms, coverage_through_ms, coverage_complete, created_ms) VALUES (?, ?, 'Synthetic', ?, '-', ?, ?, ?, ?)`,
      [datasetId, version, 'import:' + fileName, prepared.first, cov, coverageComplete ? 1 : 0, Date.now()]);
    const ds = rows(db, 'SELECT last_insert_rowid() ds')[0].ds;
    db.run('INSERT INTO result_import VALUES (?, ?, ?, ?, ?, ?, ?)', [ds, experimentId, fileName, prepared.count, Date.now(), prepared.importFingerprint, ANALYSIS_RULES_VERSION]);
    const stmt = db.prepare(INSERT_ROW);
    let done = 0;
    try {
      for await (const batch of batches) { for (const r of batch) stmt.run(rowParams(ds, r)); storeAuthTimes(db, ds, batch); done += batch.length; onProgress(`Storing rows: ${fmt(done)} of ${fmt(prepared.count)}`); }
    } finally { stmt.free(); }
    if (done !== prepared.count) throw new Error(`IMPORT_INCOMPLETE: ${done} of ${prepared.count} rows arrived`);
    const seq = (rows(db, 'SELECT MAX(m) m FROM (SELECT MAX(seq) m FROM evidence UNION ALL SELECT MAX(seq) FROM risk_review UNION ALL SELECT MAX(seq) FROM decision)')[0].m ?? 0) + 1;
    db.run('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [ev.id, seq, experimentId, plan.experimentRevision, plan.planVersion, plan.fingerprint, ds,
      ev.binding.datasetFingerprint, cov, ev.evidenceStatus, JSON.stringify(ev), Date.now()]);
    log(db, 'Imported results', 'evidence', ev.id, `${prepared.count} rows · ${ev.evidenceStatus}`);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return ev;
}

                                                                                                                           
export function auditRows({ plan, rows: data, coverageThrough, coverageComplete, datasetId = `RESULTS-${plan.experimentId}`, version = 1, evidenceId }) {
  const dataset = { id: datasetId, version, source: 'Synthetic', experimentId: plan.experimentId, experimentRevision: plan.experimentRevision, planVersion: plan.planVersion, planFingerprint: plan.fingerprint,
    coverageComplete: !!coverageComplete, coverageThrough: new Date(Date.parse(coverageThrough)).toISOString(),
    rows: data.map(r => ({ record_id: r.record_id, checkout_id: r.checkout_id, variant: r.variant, eligible: r.eligible, assigned_at: r.assigned_at, exposed_at: r.exposed_at, submitted_at: r.submitted_at, outcome_known: r.outcome_known,
      ...(isLegacyPlan(plan) ? {} : { auth_result: r.auth_result ?? null, auth_at: r.auth_at ?? null }) })) };                                              
  return auditEvidence({ plan, dataset, asOf: dataset.coverageThrough, evidenceId });
}
                                                                                                    
                                                                                                                           
                                                                  
const ROW_FIELDS_V1 = ['record_id', 'checkout_id', 'experiment_id', 'variant', 'eligible', 'assigned_at', 'exposed_at', 'submitted_at', 'auth_result', 'outcome_known', 'channel', 'payment_method', 'amount_minor'];
const ROW_FIELDS_V2 = [...ROW_FIELDS_V1.slice(0, 9), 'auth_at', ...ROW_FIELDS_V1.slice(9)];
const FINGERPRINT_FIELDS = new Map([['pcl-analysis-2.5', ROW_FIELDS_V1], [ANALYSIS_RULES_VERSION, ROW_FIELDS_V2]]);                                                         
                                                                                                                                
export async function importDigest(data, rulesVersion = ANALYSIS_RULES_VERSION) {
  const fields = FINGERPRINT_FIELDS.get(rulesVersion);
  if (!fields) return null;
  const sorted = [...data].sort((a, b) => (a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0));
  return fingerprint({ rules: rulesVersion, rows: sorted.map(r => fields.map(k => r[k] ?? null)) });
}
                                                                                                                              
                                                                                                                         
export async function digestMatches(data, imported) {
  if (!FINGERPRINT_FIELDS.has(imported.rules_version)) return undefined;
  const digest = await importDigest(data, imported.rules_version);
  return digest === null ? undefined : digest === imported.import_fingerprint;
}
                                                                                       
export function evidenceRecord(db, id) {
  const e = rows(db, 'SELECT * FROM evidence WHERE evidence_id = ?', [id])[0];
  return e ? { evidence: JSON.parse(e.result_json), imported: rows(db, 'SELECT * FROM result_import WHERE ds = ?', [e.ds])[0], experimentId: e.experiment_id } : null;
}
const asRow = r => ({ record_id: r.record_id, checkout_id: r.checkout_id, experiment_id: r.experiment_id, variant: r.variant, eligible: r.eligible === 1,
  assigned_at: new Date(r.assigned_ms).toISOString(), exposed_at: r.exposed_ms ? new Date(r.exposed_ms).toISOString() : null, submitted_at: r.submitted_ms ? new Date(r.submitted_ms).toISOString() : null,
  auth_result: r.auth_result, auth_at: r.auth_ms === null || r.auth_ms === undefined ? null : new Date(r.auth_ms).toISOString(),
  outcome_known: r.outcome_known === 1, channel: r.channel, payment_method: r.payment_method, amount_minor: r.amount_minor });
const ROWS_WITH_AUTH = 'SELECT r.*, a.auth_ms FROM result_row r LEFT JOIN result_auth a ON a.ds = r.ds AND a.record_id = r.record_id WHERE r.ds = ?';
                                                                                                          
export const resultRowsAfter = (db, ds, after, limit) => rows(db, `${ROWS_WITH_AUTH} AND r.record_id > ? ORDER BY r.record_id LIMIT ?`, [ds, after, limit]).map(asRow);
export function evidenceFor(db, id) {
  const e = rows(db, 'SELECT * FROM evidence WHERE evidence_id = ?', [id])[0];
  if (!e) return null;
  const data = rows(db, `${ROWS_WITH_AUTH} ORDER BY r.checkout_id, r.record_id`, [e.ds]).map(asRow);
  return { evidence: JSON.parse(e.result_json), rows: data, imported: rows(db, 'SELECT * FROM result_import WHERE ds = ?', [e.ds])[0] };
}

   
                                                                                                                        
                                      
                                                                                                                                     
                                                                                                                                                        
                                                                              
                                                                                       
                                                                           
                                                   
   
export async function evidenceStatusOf(db, evidenceId, check) {
  const base = { rulesVersion: check?.rulesVersion ?? null, check: check ?? null };
  if (!check || check.digestOk === undefined) return { ...base, ok: false, status: 'unverifiable', failed: check?.failed };
  if (!check.digestOk) return { ...base, ok: false, status: 'damaged' };
  const e = rows(db, 'SELECT experiment_id, plan_fingerprint, result_json FROM evidence WHERE evidence_id = ?', [evidenceId])[0];
  const planRow = e && rows(db, 'SELECT plan_json FROM plan WHERE fingerprint = ?', [e.plan_fingerprint])[0];
  if (!e || !planRow) return { ...base, ok: false, status: 'unverifiable' };
  const state = experimentState(db, e.experiment_id), plan = JSON.parse(planRow.plan_json), currentPlan = state?.plan_fingerprint === plan.fingerprint;
  const latest = state?.evidence_id === evidenceId;                                                                                  
  const current = check.rulesVersion === ANALYSIS_RULES_VERSION && !isLegacyPlan(plan) && currentPlan && latest
    && evidenceCurrent(JSON.parse(e.result_json), plan, await bindingOf(db, e.experiment_id));
  return { ...base, ok: current, status: current ? 'current' : 'historical', planSchema: plan.schema };
}
                                                                                                            
                                                                                                         
const REFUSAL = { historical: 'EVIDENCE_HISTORICAL', damaged: 'EVIDENCE_VOID', unverifiable: 'EVIDENCE_UNVERIFIABLE' };
async function assertCurrent(db, evidenceId) {
  if (!evidenceId) throw new Error('EVIDENCE_REQUIRED: there is no evidence to bind to. Import the results first.');
  const v = evidenceId ? await verifyImport(db, evidenceId) : null;
  if (!v?.ok) throw new Error(`${REFUSAL[v?.status] ?? 'EVIDENCE_VOID'}: ${evidenceId ?? 'no evidence'} is ${v?.status ?? 'missing'}, not current evidence. Freeze a plan and import the results again.`);
}
const currentRevision = (db, experimentId) => {
  const revision = experimentState(db, experimentId)?.current_revision;
  if (!revision) throw new Error(`EXPERIMENT_NOT_FOUND: ${experimentId}`);
  return revision;
};
                                                                                                                        
                                                                                                                   
export function setTolerances(db, experimentId, tolerances) {
  const revision = currentRevision(db, experimentId);
  if (rows(db, 'SELECT 1 FROM plan WHERE experiment_id = ? AND experiment_revision = ?', [experimentId, revision]).length)
    throw new Error(`REVISION_FROZEN: revision ${revision} of ${experimentId} already has a frozen plan; a change of guardrails is a new revision.`);
  const x = experiments(db).find(e => e.experiment_id === experimentId);
  const guardrails = x.guardrails.map(g => (g.tolerance === null ? g : { ...g, tolerance: Number(tolerances[g.id]) }));
  db.run('UPDATE experiment_revision SET guardrails_json = ? WHERE experiment_id = ? AND revision = ?', [JSON.stringify(guardrails), experimentId, revision]);
}
export async function recordReview(db, { experimentId, type, evidenceId, outcome, level, checks }) {
  if (type === 'evidence') await assertCurrent(db, evidenceId);
  const id = `RR-${experimentId.slice(4)}-${type === 'treatment_design' ? 'D' : 'E'}${rows(db, 'SELECT COUNT(*) n FROM risk_review WHERE experiment_id = ?', [experimentId])[0].n + 1}`;
  insertReview(db, { id, experimentId, revision: currentRevision(db, experimentId), type, evidenceId, level, outcome, checks });
  log(db, 'Recorded risk review', 'risk_review', id, outcome);
  return id;
}
                                                                                                                      
export const RESULTS_POSITIVE = 'B improves the primary metric', OVERRIDE_MARK = 'Overrides the results recommendation';
export async function resultsReading(db, experimentId) {
  const id = experimentState(db, experimentId)?.evidence_id, rec = id && evidenceRecord(db, id);
  return rec ? conclusion(rec.evidence, (await checkEvidence(db, id)).analysis) : null;
}
export async function recordDecision(db, { experimentId, verdict, rationale, nextStep, notes, override }) {
  let overriding = null;
  const bound = experimentState(db, experimentId)?.evidence_id;
  await assertCurrent(db, bound);                                                                                                         
  if (verdict === 'Planning Ready') {
                                                                                                               
    const reading = await resultsReading(db, experimentId);
    if (experimentState(db, experimentId)?.planning_ready_allowed === 1 && reading && reading.title !== RESULTS_POSITIVE) {
      if (!String(override ?? '').trim()) throw new Error('OVERRIDE_REASON_REQUIRED');
      overriding = { reading: reading.title, reason: String(override).trim() };                                    
    }
  }
  const s = experimentState(db, experimentId), id = `DEC-${experimentId.slice(4)}-${rows(db, 'SELECT COUNT(*) n FROM decision WHERE experiment_id = ?', [experimentId])[0].n + 1}`;
                                                                                       
  db.exec('BEGIN');
  try {
    insertDecision(db, { id, experimentId, revision: currentRevision(db, experimentId), planFingerprint: s.plan_fingerprint, evidenceId: s.evidence_id, designReviewId: s.design_review_id, evidenceReviewId: s.evidence_review_id,
      verdict, rationale, nextStep });
    if (notes) db.run('INSERT INTO decision_note VALUES (?, ?, ?, ?, ?)', [id, notes.alternatives, notes.assumptions, notes.changeMyMind, notes.edited ? 'Edited by user' : 'System draft, unedited']);
    if (overriding) db.run('INSERT INTO decision_override VALUES (?, ?, ?, ?)', [id, overriding.reading, overriding.reason, 'recorded']);
    log(db, 'Recorded decision', 'decision', id, verdict);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return id;
}
                                                                                                                        
export async function verifyImport(db, id) { const c = await checkEvidence(db, id); return c ? evidenceStatusOf(db, id, c.check) : null; }
                                                                                                                           
                                                                                          
let checkEvidence = async (db, id) => {
  const x = evidenceFor(db, id); if (!x) return null;
  const exp = experiments(db).find(e => e.experiment_id === x.imported.experiment_id);
  return { check: { digestOk: await digestMatches(x.rows, x.imported), rulesVersion: x.imported.rules_version },
    analysis: { ...analyse(x.rows, x.evidence, exp.guardrails), explicitUnknown: x.rows.filter(r => r.outcome_known !== true).length } };
};
export const useEvidenceChecker = fn => { checkEvidence = fn; };
   
                                                                                                             
                                                                                                                            
                                                                                                        
   
export function decisionSnapshot(db, decisionId) {
  const decision = decisions(db).find(d => d.decision_id === decisionId);
  if (!decision) return null;
  const parse = (row, key) => (row ? { ...row, [key]: JSON.parse(row[key]) } : null);
  const plan = parse(rows(db, 'SELECT * FROM plan WHERE fingerprint = ?', [decision.plan_fingerprint])[0], 'plan_json');
  const evidence = parse(rows(db, 'SELECT * FROM evidence WHERE evidence_id = ?', [decision.evidence_id])[0], 'result_json');
  const imported = evidence ? rows(db, 'SELECT * FROM result_import WHERE ds = ?', [evidence.ds])[0] ?? null : null;
  const review = id => parse(id ? rows(db, 'SELECT * FROM risk_review WHERE review_id = ?', [id])[0] : null, 'checks_json');
  const later = rows(db, 'SELECT decision_id FROM decision WHERE experiment_id = ? AND seq > ? ORDER BY seq', [decision.experiment_id, decision.seq]).map(r => r.decision_id);
  const current = experimentState(db, decision.experiment_id)?.decision_id === decisionId;
  return { decision, plan, evidence, imported, designReview: review(decision.design_review_id), evidenceReview: review(decision.evidence_review_id), current, later };
}
export const decisions = db => rows(db, `SELECT d.*, e.title, n.alternatives, n.assumptions, n.change_my_mind, n.authored_by, o.results_reading AS override_reading, o.reason AS override_reason, o.source AS override_source
  FROM decision d JOIN experiment e USING (experiment_id) LEFT JOIN decision_note n USING (decision_id) LEFT JOIN decision_override o USING (decision_id) ORDER BY d.seq DESC`);
export const activity = (db, limit = 12) => rows(db, 'SELECT * FROM activity ORDER BY seq DESC LIMIT ?', [limit]);
