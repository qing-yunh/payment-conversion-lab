                                                                                                 
                                                                                                          
                                                                                                            
PRAGMA foreign_keys = ON;

CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

                                                                                               
CREATE TABLE dataset (
  ds INTEGER PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  source TEXT NOT NULL CHECK (source = 'Synthetic'),
  generator TEXT NOT NULL,
  seed TEXT NOT NULL,
  coverage_start_ms INTEGER NOT NULL,
  coverage_through_ms INTEGER NOT NULL,
  coverage_complete INTEGER NOT NULL CHECK (coverage_complete IN (0, 1)),
  created_ms INTEGER NOT NULL,
  UNIQUE (dataset_id, version)
);

                                                                                 
CREATE TABLE checkout (
  checkout_id TEXT PRIMARY KEY,
  ds INTEGER NOT NULL REFERENCES dataset(ds),
  started_ms INTEGER NOT NULL,
  day TEXT GENERATED ALWAYS AS (date(started_ms / 1000, 'unixepoch')) STORED,
  channel TEXT NOT NULL CHECK (channel IN ('web_desktop', 'web_mobile', 'app')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('card', 'wallet', 'pay_by_bank')),
  card_scheme TEXT CHECK (card_scheme IN ('visa', 'mastercard', 'amex')),
  issuer_region TEXT CHECK (issuer_region IN ('UK', 'EEA', 'RoW')),
  customer_type TEXT NOT NULL CHECK (customer_type IN ('new', 'returning')),
  amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
  currency TEXT NOT NULL CHECK (currency = 'GBP'),
  outcome_known INTEGER NOT NULL CHECK (outcome_known IN (0, 1))
);
CREATE INDEX checkout_ds_day ON checkout (ds, day);

                                                                                         
CREATE TABLE payment_attempt (
  attempt_id TEXT PRIMARY KEY,
  checkout_id TEXT NOT NULL REFERENCES checkout(checkout_id),
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  submitted_ms INTEGER NOT NULL,
  sca_path TEXT NOT NULL CHECK (sca_path IN ('frictionless', 'challenge', 'exemption', 'not_applicable')),
  challenge_result TEXT CHECK (challenge_result IN ('completed', 'abandoned', 'failed')),
  auth_result TEXT NOT NULL CHECK (auth_result IN ('approved', 'declined', 'error', 'unknown', 'not_reached')),
  decline_reason TEXT CHECK (decline_reason IN ('insufficient_funds', 'do_not_honour', 'suspected_fraud', 'sca_required', 'card_expired')),
  resolved_ms INTEGER,
  UNIQUE (checkout_id, attempt_no),
  CHECK ((sca_path = 'challenge') = (challenge_result IS NOT NULL)),
  CHECK ((auth_result = 'declined') = (decline_reason IS NOT NULL))
);

                                                                                          
CREATE TABLE experiment_assignment (
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  checkout_id TEXT NOT NULL REFERENCES checkout(checkout_id),
  variant TEXT NOT NULL CHECK (variant IN ('A', 'B')),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  assigned_ms INTEGER NOT NULL,
  exposed_ms INTEGER,
  PRIMARY KEY (experiment_id, checkout_id)
) WITHOUT ROWID;

                                                                                                  
CREATE TABLE daily_funnel (
  ds INTEGER NOT NULL,
  day TEXT NOT NULL,
  channel TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  started INTEGER NOT NULL,
  submitted INTEGER NOT NULL,                                        
  auth_reached INTEGER NOT NULL,                                                             
  approved INTEGER NOT NULL,                                                 
  auth_unknown INTEGER NOT NULL,                                                                      
  challenge_attempts INTEGER NOT NULL,
  challenge_completed_attempts INTEGER NOT NULL,
  approved_amount_minor INTEGER NOT NULL,
  PRIMARY KEY (ds, day, channel, payment_method)
) WITHOUT ROWID;

                                                                                                   
CREATE TABLE opportunity (
  opportunity_id TEXT PRIMARY KEY,                                                
  title TEXT NOT NULL,
  metric_id TEXT NOT NULL,
  segment TEXT NOT NULL,
  baseline_window TEXT NOT NULL,
  current_window TEXT NOT NULL,
  baseline_rate REAL,
  current_rate REAL,
  source TEXT NOT NULL CHECK (source IN ('Monitor alert', 'Manual')),
  status TEXT NOT NULL CHECK (status IN ('New', 'Investigating', 'Hypothesis ready', 'In experiment', 'Closed')),
  created_ms INTEGER NOT NULL
);

CREATE TABLE hypothesis (
  hypothesis_id TEXT PRIMARY KEY,                    
  opportunity_id TEXT NOT NULL REFERENCES opportunity(opportunity_id),
  statement TEXT NOT NULL,
  mechanism TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Proposed', 'Selected', 'Rejected')),
  created_ms INTEGER NOT NULL
);

                                                                      
CREATE TABLE experiment (
  experiment_id TEXT PRIMARY KEY,                       
  hypothesis_id TEXT NOT NULL REFERENCES hypothesis(hypothesis_id),
  title TEXT NOT NULL,
  primary_metric_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

                                                                                                 
CREATE TABLE experiment_revision (
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  treatment TEXT NOT NULL,
  eligibility_version TEXT NOT NULL,
  guardrails_json TEXT NOT NULL,
  change_reason TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  PRIMARY KEY (experiment_id, revision)
);

                                                                                             
CREATE TABLE plan (
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  plan_version INTEGER NOT NULL CHECK (plan_version >= 1),
  experiment_revision INTEGER NOT NULL,
  fingerprint TEXT NOT NULL UNIQUE,
  mde_pp REAL NOT NULL,
  required_per_arm INTEGER NOT NULL,
  frozen_ms INTEGER NOT NULL,
  plan_json TEXT NOT NULL,
  PRIMARY KEY (experiment_id, plan_version),
  FOREIGN KEY (experiment_id, experiment_revision) REFERENCES experiment_revision(experiment_id, revision)
);

                                                                                                 
CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  experiment_revision INTEGER NOT NULL,
  plan_version INTEGER NOT NULL,
  plan_fingerprint TEXT NOT NULL REFERENCES plan(fingerprint),
  ds INTEGER NOT NULL REFERENCES dataset(ds),
  dataset_fingerprint TEXT NOT NULL,
  as_of_ms INTEGER NOT NULL,
  evidence_status TEXT NOT NULL CHECK (evidence_status IN ('Synthetic Evidence Checked', 'Need More Evidence', 'Stop / Blocked')),
  result_json TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);

                                                                                  
CREATE TABLE risk_review (
  review_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  experiment_revision INTEGER NOT NULL,
  review_type TEXT NOT NULL CHECK (review_type IN ('treatment_design', 'evidence')),
  evidence_id TEXT REFERENCES evidence(evidence_id),
  evidence_level TEXT NOT NULL CHECK (evidence_level IN ('Verified With Available Data', 'Design Review Only', 'Missing Data', 'Not Verified')),
  outcome TEXT NOT NULL CHECK (outcome IN ('Pass', 'Fail', 'Unknown')),
  checks_json TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  CHECK ((review_type = 'evidence') = (evidence_id IS NOT NULL)),
  CHECK (NOT (outcome = 'Pass' AND evidence_level IN ('Missing Data', 'Not Verified')))
);

                                                                                                 
CREATE TABLE decision (
  decision_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL UNIQUE,
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  experiment_revision INTEGER NOT NULL,
  plan_fingerprint TEXT NOT NULL REFERENCES plan(fingerprint),
  evidence_id TEXT REFERENCES evidence(evidence_id),
  design_review_id TEXT REFERENCES risk_review(review_id),
  evidence_review_id TEXT REFERENCES risk_review(review_id),
  verdict TEXT NOT NULL CHECK (verdict IN ('Planning Ready', 'Need More Evidence', 'Stop / Blocked')),
  rationale TEXT NOT NULL,
  next_step TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_ms INTEGER NOT NULL
);

CREATE TABLE activity (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  detail TEXT
);

                                                          
CREATE TRIGGER plan_no_update BEFORE UPDATE ON plan BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: plan'); END;
CREATE TRIGGER plan_no_delete BEFORE DELETE ON plan BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: plan'); END;
CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: evidence'); END;
CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: evidence'); END;
CREATE TRIGGER review_no_update BEFORE UPDATE ON risk_review BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: risk_review'); END;
CREATE TRIGGER review_no_delete BEFORE DELETE ON risk_review BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: risk_review'); END;
CREATE TRIGGER decision_no_update BEFORE UPDATE ON decision BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision'); END;
CREATE TRIGGER decision_no_delete BEFORE DELETE ON decision BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision'); END;

                                                                                                   
CREATE VIEW v_current_revision AS
  SELECT experiment_id, MAX(revision) AS revision FROM experiment_revision GROUP BY experiment_id;

                                                                     
CREATE VIEW v_current_plan AS
  SELECT p.* FROM plan p
  JOIN v_current_revision r ON r.experiment_id = p.experiment_id AND r.revision = p.experiment_revision
  WHERE p.plan_version = (SELECT MAX(plan_version) FROM plan x WHERE x.experiment_id = p.experiment_id);

CREATE VIEW v_current_evidence AS
  SELECT e.* FROM evidence e JOIN v_current_plan p ON p.fingerprint = e.plan_fingerprint
  WHERE e.seq = (SELECT MAX(seq) FROM evidence x WHERE x.plan_fingerprint = e.plan_fingerprint);

                                                                                     
CREATE VIEW v_current_design_review AS
  SELECT rv.* FROM risk_review rv JOIN v_current_revision r
    ON r.experiment_id = rv.experiment_id AND r.revision = rv.experiment_revision
  WHERE rv.review_type = 'treatment_design'
    AND rv.seq = (SELECT MAX(seq) FROM risk_review x WHERE x.experiment_id = rv.experiment_id
                  AND x.experiment_revision = rv.experiment_revision AND x.review_type = 'treatment_design');

                                                         
CREATE VIEW v_current_evidence_review AS
  SELECT rv.* FROM risk_review rv JOIN v_current_evidence e ON e.evidence_id = rv.evidence_id
  WHERE rv.seq = (SELECT MAX(seq) FROM risk_review x WHERE x.evidence_id = rv.evidence_id);

CREATE VIEW v_experiment_state AS
  SELECT ex.experiment_id,
    r.revision AS current_revision,
    p.plan_version, p.fingerprint AS plan_fingerprint, p.required_per_arm,
    (SELECT COUNT(*) FROM plan x WHERE x.experiment_id = ex.experiment_id) > 0 AND p.fingerprint IS NULL AS plan_stale,
    e.evidence_id, e.evidence_status,
    dr.review_id AS design_review_id, dr.outcome AS design_outcome,
    er.review_id AS evidence_review_id, er.outcome AS evidence_outcome, er.evidence_level AS evidence_review_level,
    d.decision_id, d.verdict,
    (e.evidence_status = 'Synthetic Evidence Checked' AND dr.outcome = 'Pass' AND er.outcome = 'Pass') AS planning_ready_allowed,
    CASE
      WHEN p.fingerprint IS NULL THEN 'Design'
      WHEN e.evidence_id IS NULL THEN 'Planned'
      WHEN e.evidence_status <> 'Synthetic Evidence Checked' THEN 'Results'
      WHEN dr.review_id IS NULL OR er.review_id IS NULL THEN 'Risk review'
      WHEN d.decision_id IS NULL THEN 'Decision'
      ELSE 'Decided'
    END AS stage
  FROM experiment ex
  JOIN v_current_revision r ON r.experiment_id = ex.experiment_id
  LEFT JOIN v_current_plan p ON p.experiment_id = ex.experiment_id
  LEFT JOIN v_current_evidence e ON e.experiment_id = ex.experiment_id
  LEFT JOIN v_current_design_review dr ON dr.experiment_id = ex.experiment_id
  LEFT JOIN v_current_evidence_review er ON er.experiment_id = ex.experiment_id
  LEFT JOIN decision d ON d.experiment_id = ex.experiment_id
    AND d.plan_fingerprint = p.fingerprint AND d.evidence_id = e.evidence_id
    AND d.design_review_id = dr.review_id AND d.evidence_review_id = er.review_id
    AND d.seq = (SELECT MAX(seq) FROM decision x WHERE x.experiment_id = ex.experiment_id);

                                                                             
CREATE TRIGGER decision_gate BEFORE INSERT ON decision
WHEN NEW.verdict = 'Planning Ready' AND NOT COALESCE((
  SELECT s.planning_ready_allowed FROM v_experiment_state s
  WHERE s.experiment_id = NEW.experiment_id AND s.plan_fingerprint = NEW.plan_fingerprint
    AND s.evidence_id = NEW.evidence_id AND s.design_review_id = NEW.design_review_id
    AND s.evidence_review_id = NEW.evidence_review_id), 0)
BEGIN SELECT RAISE(ABORT, 'PLANNING_READY_GATE_NOT_MET'); END;
