                                                                                          
                                                                                        
CREATE TABLE daily_cube (
  day TEXT NOT NULL,
  channel TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  card_scheme TEXT NOT NULL,                                    
  issuer_region TEXT NOT NULL,                                  
  customer_type TEXT NOT NULL,
  started INTEGER NOT NULL,
  submitted INTEGER NOT NULL,
  reached INTEGER NOT NULL,
  approved INTEGER NOT NULL,
  unknown INTEGER NOT NULL,
  ch INTEGER NOT NULL,
  ch_done INTEGER NOT NULL,
  approved_amount INTEGER NOT NULL,
  soft_declined INTEGER NOT NULL,
  soft_no_retry INTEGER NOT NULL,
  if_no_retry INTEGER NOT NULL                                                                                                           
);
CREATE INDEX daily_cube_day ON daily_cube (day);

CREATE TABLE result_import (
  ds INTEGER PRIMARY KEY REFERENCES dataset(ds),
  experiment_id TEXT NOT NULL REFERENCES experiment(experiment_id),
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  imported_ms INTEGER NOT NULL,
  import_fingerprint TEXT NOT NULL,                                                                                  
  rules_version TEXT NOT NULL
);

CREATE TABLE result_row (
  ds INTEGER NOT NULL REFERENCES dataset(ds),
  record_id TEXT NOT NULL,
  checkout_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL CHECK (variant IN ('A', 'B')),
  eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
  assigned_ms INTEGER NOT NULL,
  exposed_ms INTEGER,
  submitted_ms INTEGER,
  auth_result TEXT CHECK (auth_result IN ('approved', 'declined', 'error', 'unknown', 'not_reached')),
  outcome_known INTEGER NOT NULL CHECK (outcome_known IN (0, 1)),
  channel TEXT,
  payment_method TEXT,
  amount_minor INTEGER,
  PRIMARY KEY (ds, record_id)
) WITHOUT ROWID;

CREATE TRIGGER result_row_no_update BEFORE UPDATE ON result_row BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_row'); END;
CREATE TRIGGER result_row_no_delete BEFORE DELETE ON result_row BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_row'); END;

                                                                               
CREATE TABLE decision_note (
  decision_id TEXT PRIMARY KEY REFERENCES decision(decision_id),
  alternatives TEXT NOT NULL,
  assumptions TEXT NOT NULL,
  change_my_mind TEXT NOT NULL,
  authored_by TEXT NOT NULL CHECK (authored_by IN ('Edited by user', 'System draft, unedited'))
);

                                                                                            
CREATE TABLE opportunity_finding (
  opportunity_id TEXT PRIMARY KEY REFERENCES opportunity(opportunity_id),
  finding_json TEXT NOT NULL
);

                                                                                                                               
                                                                                                                                     
                                                                                                                  
DROP VIEW v_experiment_state;
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
      WHEN d.decision_id IS NOT NULL THEN 'Decided'
      WHEN e.evidence_status <> 'Synthetic Evidence Checked' THEN 'Results'
      WHEN dr.review_id IS NULL OR er.review_id IS NULL THEN 'Risk review'
      ELSE 'Decision'
    END AS stage
  FROM experiment ex
  JOIN v_current_revision r ON r.experiment_id = ex.experiment_id
  LEFT JOIN v_current_plan p ON p.experiment_id = ex.experiment_id
  LEFT JOIN v_current_evidence e ON e.experiment_id = ex.experiment_id
  LEFT JOIN v_current_design_review dr ON dr.experiment_id = ex.experiment_id
  LEFT JOIN v_current_evidence_review er ON er.experiment_id = ex.experiment_id
  LEFT JOIN decision d ON d.experiment_id = ex.experiment_id
    AND d.plan_fingerprint = p.fingerprint AND d.evidence_id = e.evidence_id
    AND d.design_review_id IS dr.review_id AND d.evidence_review_id IS er.review_id
    AND d.seq = (SELECT MAX(seq) FROM decision x WHERE x.experiment_id = ex.experiment_id);

                                                                                                                             
                                                                                                              
CREATE TABLE decision_override (
  decision_id TEXT PRIMARY KEY REFERENCES decision(decision_id),
  results_reading TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('recorded', 'read from the rationale text'))
);
CREATE TRIGGER decision_override_no_update BEFORE UPDATE ON decision_override BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision_override'); END;
CREATE TRIGGER decision_override_no_delete BEFORE DELETE ON decision_override BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision_override'); END;

                                                                                                                
                                                                               
CREATE TRIGGER decision_note_no_update BEFORE UPDATE ON decision_note BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision_note'); END;
CREATE TRIGGER decision_note_no_delete BEFORE DELETE ON decision_note BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision_note'); END;
CREATE TRIGGER result_import_no_update BEFORE UPDATE ON result_import BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_import'); END;
CREATE TRIGGER result_import_no_delete BEFORE DELETE ON result_import BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_import'); END;
CREATE TRIGGER opportunity_finding_no_update BEFORE UPDATE ON opportunity_finding BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: opportunity_finding'); END;
CREATE TRIGGER opportunity_finding_no_delete BEFORE DELETE ON opportunity_finding BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: opportunity_finding'); END;

                                                                                                                                    
                                                                                                                                
CREATE TABLE result_auth (
  ds INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  auth_ms INTEGER NOT NULL,
  PRIMARY KEY (ds, record_id)
) WITHOUT ROWID;
CREATE TRIGGER result_auth_row_exists BEFORE INSERT ON result_auth WHEN NOT EXISTS (SELECT 1 FROM result_row WHERE ds = NEW.ds AND record_id = NEW.record_id) BEGIN SELECT RAISE(ABORT, 'RESULT_AUTH_WITHOUT_ROW'); END;
CREATE TRIGGER result_auth_no_update BEFORE UPDATE ON result_auth BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_auth'); END;
CREATE TRIGGER result_auth_no_delete BEFORE DELETE ON result_auth BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_auth'); END;

                                                                                  
PRAGMA user_version = 4;
