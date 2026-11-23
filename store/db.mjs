                                                                                        
const now = () => globalThis.performance.now();
export const SCHEMA_VERSION = 'pcl-v2x-schema-draft-1';

export function rows(db, sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    return out;
  } finally { stmt.free(); }
}
const one = (db, sql, params) => rows(db, sql, params)[0];

function insertMany(db, sql, data) {
  const stmt = db.prepare(sql);
  try { for (const row of data) stmt.run(row); } finally { stmt.free(); }
}

                                                                                             
export function buildDatabase(SQL, schemaSql, generated, seedObjects) {
  const t = {}, t0 = now();
  const db = new SQL.Database();
  db.exec(schemaSql);
  t.schemaMs = now() - t0;
  const t1 = now();
  db.exec('BEGIN');
  try {
    db.run('INSERT INTO app_meta VALUES (?, ?), (?, ?)', ['schema_version', SCHEMA_VERSION, 'seed', generated.dataset.seed]);
    const d = generated.dataset;
    db.run('INSERT INTO dataset (ds, dataset_id, version, source, generator, seed, coverage_start_ms, coverage_through_ms, coverage_complete, created_ms) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [d.dataset_id, d.version, d.source, d.generator, d.seed, d.coverage_start_ms, d.coverage_through_ms, d.coverage_complete, d.coverage_through_ms]);
    seedObjects(db);
    insertMany(db, 'INSERT INTO checkout (checkout_id, ds, started_ms, channel, payment_method, card_scheme, issuer_region, customer_type, amount_minor, currency, outcome_known) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)', generated.checkouts);
    insertMany(db, 'INSERT INTO payment_attempt VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', generated.attempts);
    insertMany(db, 'INSERT INTO experiment_assignment VALUES (?, ?, ?, ?, ?, ?)', generated.assignments);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  t.insertMs = now() - t1;
  const t2 = now();
  rebuildAggregate(db);
  t.aggregateMs = now() - t2;
  return { db, timings: t };
}

export function rebuildAggregate(db) {
  db.exec(`DELETE FROM daily_funnel;
    INSERT INTO daily_funnel
    SELECT c.ds, c.day, c.channel, c.payment_method, COUNT(*),
      SUM(a.checkout_id IS NOT NULL), SUM(COALESCE(a.reached, 0)), SUM(COALESCE(a.approved, 0)),
      SUM(COALESCE(a.reached AND NOT a.approved AND a.unknown, 0)),
      SUM(COALESCE(a.challenges, 0)), SUM(COALESCE(a.challenges_done, 0)),
      SUM(CASE WHEN a.approved THEN c.amount_minor ELSE 0 END)
    FROM checkout c LEFT JOIN (
      SELECT checkout_id,
        MAX(auth_result <> 'not_reached') AS reached, MAX(auth_result = 'approved') AS approved,
        MAX(auth_result = 'unknown') AS unknown,
        SUM(sca_path = 'challenge') AS challenges, SUM(challenge_result = 'completed') AS challenges_done
      FROM payment_attempt GROUP BY checkout_id) a ON a.checkout_id = c.checkout_id
    GROUP BY c.ds, c.day, c.channel, c.payment_method;`);
}

                                                                                              
export const monitorQueries = {
  dailyKpi: (db, from, to) => rows(db, `SELECT day, SUM(started) started, SUM(submitted) submitted, SUM(approved) approved,
      SUM(auth_reached) reached, SUM(auth_unknown) unknown, SUM(challenge_attempts) ch, SUM(challenge_completed_attempts) ch_done,
      ROUND(1.0 * SUM(submitted) / SUM(started), 4) submission_rate, ROUND(1.0 * SUM(approved) / SUM(started), 4) auth_conversion
    FROM daily_funnel WHERE ds = 1 AND day BETWEEN ? AND ? GROUP BY day ORDER BY day`, [from, to]),
  rolling7: (db, channel) => rows(db, `SELECT day, ROUND(1.0 * SUM(SUM(submitted)) OVER w / SUM(SUM(started)) OVER w, 4) submission_7d
    FROM daily_funnel WHERE ds = 1 AND (? IS NULL OR channel = ?) GROUP BY day
    WINDOW w AS (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) ORDER BY day`, [channel ?? null, channel ?? null]),
  periodCompare: (db, a, b) => rows(db, `SELECT channel,
      ROUND(1.0 * SUM(CASE WHEN day BETWEEN ? AND ? THEN submitted END) / SUM(CASE WHEN day BETWEEN ? AND ? THEN started END), 4) before_rate,
      ROUND(1.0 * SUM(CASE WHEN day BETWEEN ? AND ? THEN submitted END) / SUM(CASE WHEN day BETWEEN ? AND ? THEN started END), 4) after_rate
    FROM daily_funnel WHERE ds = 1 GROUP BY channel ORDER BY channel`, [a[0], a[1], a[0], a[1], b[0], b[1], b[0], b[1]]),
  dailyKpiRaw: (db, from, to) => rows(db, `SELECT c.day, COUNT(*) started, COUNT(a.checkout_id) submitted
    FROM checkout c LEFT JOIN (SELECT DISTINCT checkout_id FROM payment_attempt) a ON a.checkout_id = c.checkout_id
    WHERE c.day BETWEEN ? AND ? GROUP BY c.day ORDER BY c.day`, [from, to]),
  declineMix: (db, from, to) => rows(db, `SELECT decline_reason, COUNT(*) n FROM payment_attempt pa JOIN checkout c USING (checkout_id)
    WHERE c.day BETWEEN ? AND ? AND pa.auth_result = 'declined' GROUP BY decline_reason ORDER BY n DESC`, [from, to]),
};

                                                                                                 
const iso = ms => (ms === null || ms === undefined ? null : new Date(ms).toISOString());

                                                                                             
export function exportExperimentDataset(db, plan) {
  const ds = one(db, 'SELECT * FROM dataset WHERE ds = 1');
  const out = [];
  const stmt = db.prepare(`SELECT ea.checkout_id, ea.variant, ea.eligible, ea.assigned_ms, ea.exposed_ms, c.outcome_known,
      pa.attempt_id, pa.submitted_ms
    FROM experiment_assignment ea JOIN checkout c USING (checkout_id)
    LEFT JOIN payment_attempt pa ON pa.checkout_id = ea.checkout_id
    WHERE ea.experiment_id = ? ORDER BY ea.checkout_id, pa.attempt_no`);
  try {
    stmt.bind([plan.experimentId]);
    while (stmt.step()) {
      const [checkoutId, variant, eligible, assignedMs, exposedMs, known, attemptId, submittedMs] = stmt.get();
      out.push({ record_id: attemptId ?? checkoutId + '#none', checkout_id: checkoutId, variant, eligible: eligible === 1,
        assigned_at: iso(assignedMs), exposed_at: iso(exposedMs), submitted_at: iso(submittedMs), outcome_known: known === 1 });
    }
  } finally { stmt.free(); }
  return { id: ds.dataset_id, version: ds.version, source: ds.source,
    description: 'Synthetic dataset; constructed outcomes, not observed business results.',
    experimentId: plan.experimentId, experimentRevision: plan.experimentRevision,
    planVersion: plan.planVersion, planFingerprint: plan.fingerprint,
    coverageComplete: ds.coverage_complete === 1, coverageThrough: iso(ds.coverage_through_ms), rows: out };
}

                                                                                                 
export function seedStoryObjects(db) {
  const t = Date.parse('2026-10-01T09:00:00Z');
  db.run(`INSERT INTO opportunity VALUES ('P-01', 'Mobile checkout submission fell after the address-form release',
    'PAYMENT_SUBMISSION_30M_ITT', 'channel=web_mobile', '2026-08-10..2026-09-14', '2026-09-15..2026-09-30', NULL, NULL,
    'Monitor alert', 'In experiment', ?)`, [t]);
  db.run(`INSERT INTO hypothesis VALUES ('H-11', 'P-01', 'A shorter, single-column form with address lookup will raise payment submission within 30 minutes.',
    'Fewer fields and less typing on small screens reduce abandonment before submit.', 'Selected', ?)`, [t]);
  db.run(`INSERT INTO experiment VALUES ('EXP-001', 'H-11', 'Lean checkout form', 'PAYMENT_SUBMISSION_30M_ITT', ?)`, [t]);
  db.run(`INSERT INTO experiment_revision VALUES ('EXP-001', 1, 'lean_form', 'checkout-demo-eligible-v1',
    '["approval_rate","challenge_rate","suspected_fraud_decline_share","average_order_value"]', 'Initial design', ?)`, [t]);
}

let seq = 0;
const nextSeq = db => (seq = Math.max(seq, one(db, `SELECT MAX(m) m FROM (SELECT MAX(seq) m FROM evidence UNION ALL
  SELECT MAX(seq) FROM risk_review UNION ALL SELECT MAX(seq) FROM decision)`).m ?? 0) + 1);

export function insertPlan(db, plan) {
  db.run('INSERT INTO plan VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [plan.experimentId, plan.planVersion, plan.experimentRevision,
    plan.fingerprint, plan.mdePP, plan.requiredPerArm, Date.parse(plan.frozenAt), JSON.stringify(plan)]);
}
export function insertEvidence(db, ev, plan) {
  db.run('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)', [ev.id, nextSeq(db), plan.experimentId,
    plan.experimentRevision, plan.planVersion, plan.fingerprint, ev.binding.datasetFingerprint, Date.parse(ev.asOf),
    ev.evidenceStatus, JSON.stringify(ev), Date.parse(ev.asOf)]);
}
export function insertReview(db, r) {
  db.run('INSERT INTO risk_review VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [r.id, nextSeq(db), r.experimentId, r.revision,
    r.type, r.evidenceId ?? null, r.level, r.outcome, JSON.stringify(r.checks ?? []), 'Demo PM', Date.now()]);
}
export function insertDecision(db, d) {
  db.run('INSERT INTO decision VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [d.id, nextSeq(db), d.experimentId, d.revision,
    d.planFingerprint, d.evidenceId, d.designReviewId, d.evidenceReviewId, d.verdict, d.rationale, d.nextStep, 'Demo PM', Date.now()]);
}
export const experimentState = (db, id) => one(db, 'SELECT * FROM v_experiment_state WHERE experiment_id = ?', [id]);

                                                                        
export async function contentDigest(db) {
  const parts = [];
  for (const sql of ['SELECT COUNT(*), SUM(started_ms % 1000003), SUM(amount_minor) FROM checkout',
    "SELECT COUNT(*), SUM(submitted_ms % 1000003), SUM(auth_result = 'approved') FROM payment_attempt",
    "SELECT COUNT(*), SUM(variant = 'B'), SUM(COALESCE(exposed_ms, 0) % 1000003) FROM experiment_assignment",
    'SELECT group_concat(day || started || submitted || approved, \'|\') FROM (SELECT * FROM daily_funnel ORDER BY day, channel, payment_method)']) {
    parts.push(JSON.stringify(db.exec(sql)[0].values));
  }
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\n')));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
