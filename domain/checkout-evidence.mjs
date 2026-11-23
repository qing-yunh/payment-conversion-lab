import { assignCheckout, deepFreeze, fingerprint, METRIC, METRICS, PLAN_V2, timestamp, validatePlan } from './checkout-plan.mjs';

function normalCdf(x) {
  const z = Math.abs(x) / Math.SQRT2, t = 1 / (1 + 0.3275911 * z);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + Math.sign(x) * erf);
}
function twoSidedP(z) { return Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z))))); }

export function srm(countA, countB) {
  const total = countA + countB;
                                                                             
  return total < 10 ? null : twoSidedP((countA - total / 2) / Math.sqrt(total / 4));
}

export function proportionTest(a, b) {
  if ([a.success, b.success, a.assigned - a.success, b.assigned - b.success].some(n => n < 5)) return null;
  const pa = a.success / a.assigned, pb = b.success / b.assigned;
  const pooled = (a.success + b.success) / (a.assigned + b.assigned);
  const standardError = Math.sqrt(pooled * (1 - pooled) * (1 / a.assigned + 1 / b.assigned));
  const ciError = 1.9599639845 * Math.sqrt(pa * (1 - pa) / a.assigned + pb * (1 - pb) / b.assigned);
  const difference = pb - pa;
  if (!Number.isFinite(standardError) || standardError <= 0) return null;
  return { difference, pValue: twoSidedP(difference / standardError), ci95: [difference - ciError, difference + ciError] };
}

const armCounts = () => ({ assigned: 0, success: 0, nonSubmission: 0, pending: 0, unknown: 0 });
                                                                                                   
                                                                                        
const armCountsV2 = () => ({ assigned: 0, success: 0, notSuccess: 0, pending: 0, unknown: 0, invalid: 0 });

                                                                                                                                
                                                                   
                                                                                                                               
function outcomeV2({ attempts, assigned, cutoff, coverage, complete, metric, issues }) {
  const windowMs = metric.windowMinutes * 60_000, auth = metric.success === 'approved';
  let success = false, unknown = false, invalid = assigned === null, hasExposure = false;
  const check = (field, value) => {                                                                   
    const t = timestamp(value);
    if (t === null) { issues.push('INVALID_EVENT_TIME'); invalid = true; return null; }
    if (cutoff !== null && t > cutoff) { issues.push('FUTURE_EVENT'); invalid = true; }
    if (assigned !== null && t < assigned) { issues.push('EVENT_BEFORE_ASSIGNMENT'); invalid = true; }
    return t;
  };
  const inWindow = t => t !== null && assigned !== null && t >= assigned && t <= assigned + windowMs && (cutoff === null || t <= cutoff);
  for (const row of attempts) {
    if (row.outcome_known !== true) unknown = true;
    const exposed = row.exposed_at === null || row.exposed_at === undefined || row.exposed_at === '' ? null : check('exposed_at', row.exposed_at);
    if (exposed !== null) hasExposure = true;
    const absentSubmission = row.submitted_at === undefined || row.submitted_at === '';
    const submitted = row.submitted_at === null || absentSubmission ? null : check('submitted_at', row.submitted_at);
    if (exposed !== null && submitted !== null && submitted < exposed) { issues.push('SUBMISSION_BEFORE_EXPOSURE'); invalid = true; }
    if (!auth) {
      if (absentSubmission) unknown = true;
      if (inWindow(submitted)) success = true;
      continue;
    }
    const result = row.auth_result ?? null, hasTime = !(row.auth_at === null || row.auth_at === undefined || row.auth_at === '');
    if (hasTime && result === null) { issues.push('AUTH_TIME_WITHOUT_RESULT'); invalid = true; continue; }
    const authAt = hasTime ? check('auth_at', row.auth_at) : null;
    if (authAt !== null && submitted !== null && authAt < submitted) { issues.push('AUTH_BEFORE_SUBMISSION'); invalid = true; }
    if (result === 'approved') {
      if (submitted === null) { issues.push('APPROVAL_WITHOUT_SUBMISSION'); invalid = true; }
      else if (!hasTime) unknown = true;                                   
      else if (inWindow(authAt)) success = true;
    } else if (result === 'unknown' || (result === null && (submitted !== null || absentSubmission))) unknown = true;                                  
  }
  let outcome;
  if (invalid) outcome = 'invalid';
  else if (cutoff === null || assigned > cutoff) outcome = 'unknown';
  else if (assigned + windowMs > cutoff) outcome = 'pending';                                                        
  else if (complete !== true || coverage === null || coverage < assigned + windowMs) outcome = 'unknown';
  else if (success) outcome = 'success';
  else if (unknown) outcome = 'unknown';
  else outcome = 'notSuccess';
  return { outcome, hasExposure };
}

export async function auditEvidence({ plan, dataset, asOf, evidenceId }) {
  const planErrors = await validatePlan(plan);
  const issues = [], warnings = [], need = [...planErrors];
  const v2 = plan?.schema === PLAN_V2, metric = v2 ? METRICS[plan.metricId] : METRIC;
  const counts = v2 ? { A: armCountsV2(), B: armCountsV2() } : { A: armCounts(), B: armCounts() };
  const cutoff = timestamp(asOf);
  const safeDataset = dataset && typeof dataset === 'object' ? dataset : {};
  const datasetFingerprint = await fingerprint(safeDataset);
  const binding = {
    experimentId: plan?.experimentId ?? null, experimentRevision: plan?.experimentRevision ?? null,
    planVersion: plan?.planVersion ?? null, planFingerprint: plan?.fingerprint ?? null,
    metricId: metric?.id ?? null, metricVersion: metric?.version ?? null,
    datasetId: safeDataset.id ?? null, datasetVersion: safeDataset.version ?? null, datasetFingerprint,
  };
  const result = {
    id: evidenceId || `EV-${datasetFingerprint.slice(0, 12)}-P${plan?.planVersion ?? 'missing'}`,
    binding, asOf, coverageThrough: safeDataset.coverageThrough ?? null,
    source: safeDataset.source ?? 'Unknown',
    label: 'Synthetic tool verification only; no real growth or causal result.',
    counts, issues, warnings, need, rawRows: 0, duplicateRecords: 0, retryRows: 0, missingExposure: 0,
    sampleSufficient: false, srmP: null, rates: { A: null, B: null }, statistics: null,
    evidenceStatus: 'Need More Evidence', statisticalStatus: 'Not Computable',
                                                                     
    risk: { designReview: null, evidenceReview: null, guardrails: 'Missing Data / Not Verified', outcome: 'Unknown' },
    decisionIntegration: 'Not Implemented', canPrepare: false, canRollout: false,
  };
  if (planErrors.length) return deepFreeze(result);                       
  if (cutoff === null) issues.push('INVALID_ANALYSIS_CUTOFF');
  if (!Array.isArray(safeDataset.rows)) issues.push('MISSING_ROWS');
  if (!safeDataset.id || !Number.isSafeInteger(safeDataset.version) || safeDataset.version < 1) issues.push('MISSING_DATASET_IDENTITY');
  if (safeDataset.source !== 'Synthetic') need.push('SOURCE_NOT_VERIFIED: only the Synthetic demonstration is supported');
  if (safeDataset.experimentId !== plan.experimentId || safeDataset.experimentRevision !== plan.experimentRevision) issues.push('EXPERIMENT_REVISION_MISMATCH');
  if (safeDataset.planVersion !== plan.planVersion || safeDataset.planFingerprint !== plan.fingerprint) issues.push('PLAN_VERSION_OR_FINGERPRINT_MISMATCH');
  const coverage = timestamp(safeDataset.coverageThrough);
  if (coverage === null || safeDataset.coverageComplete !== true) need.push('UNKNOWN_EVENT_COVERAGE');
  if (coverage !== null && cutoff !== null && coverage > cutoff) issues.push('FUTURE_COVERAGE_WATERMARK');
  const horizonEnd = timestamp(plan.enrollmentEnd) + metric.windowMinutes * 60_000;
  if (cutoff !== null && cutoff < horizonEnd) need.push('PENDING_FIXED_HORIZON');
  if (safeDataset.coverageComplete !== true || coverage === null || coverage < horizonEnd) need.push('INCOMPLETE_FIXED_HORIZON_COVERAGE');
  const rows = safeDataset.rows ?? [], groups = new Map(), seenRecords = new Set();
  result.rawRows = Array.isArray(rows) ? rows.length : 0;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || !row.checkout_id || !row.record_id) { issues.push('MISSING_CHECKOUT_OR_RECORD_ID'); continue; }
    if (seenRecords.has(row.record_id)) { result.duplicateRecords++; issues.push('DUPLICATE_RECORD_ID'); }
    seenRecords.add(row.record_id);
    if (typeof row.eligible !== 'boolean') issues.push('UNKNOWN_ELIGIBILITY');
    if (!['A', 'B'].includes(row.variant)) issues.push('INVALID_ARM');
    if (!groups.has(row.checkout_id)) groups.set(row.checkout_id, []);
    groups.get(row.checkout_id).push(row);
  }
  for (const [id, attempts] of groups) {
    const first = attempts[0];
    result.retryRows += attempts.length - 1;
    if (attempts.some(r => r.variant !== first.variant || r.assigned_at !== first.assigned_at || r.eligible !== first.eligible)) issues.push('CONFLICTING_CHECKOUT_ASSIGNMENT');
    if (first.eligible !== true || !counts[first.variant]) continue;
    const arm = counts[first.variant];
    arm.assigned++;                                                                     
    if (first.variant !== assignCheckout(plan.experimentId, id, plan.assignmentSeed)) issues.push('DEMO_ASSIGNMENT_MISMATCH');
    const assigned = timestamp(first.assigned_at);
    if (assigned === null) issues.push('MISSING_OR_INVALID_ASSIGNMENT_TIME');
    else {
      if (assigned > cutoff) issues.push('FUTURE_ASSIGNMENT');
      if (assigned < timestamp(plan.enrollmentStart) || assigned > timestamp(plan.enrollmentEnd)) issues.push('OUTSIDE_ENROLLMENT_HORIZON');
    }
    if (v2) {
      const { outcome, hasExposure } = outcomeV2({ attempts, assigned, cutoff, coverage, complete: safeDataset.coverageComplete, metric, issues });
      arm[outcome]++;
      if (!hasExposure) result.missingExposure++;
      continue;
    }
    let success = false, unknown = false, invalid = assigned === null;
    let hasExposure = false;
    for (const row of attempts) {
      if (typeof row.outcome_known !== 'boolean') unknown = true;
      if (row.outcome_known !== true) unknown = true;
      for (const field of ['exposed_at', 'submitted_at']) {
        const value = row[field];
        if (value === null) continue;
        if (value === undefined || value === '') {
          if (field === 'submitted_at') unknown = true;
          continue;
        }
        const eventTime = timestamp(value);
        if (eventTime === null) { issues.push('INVALID_EVENT_TIME'); invalid = true; continue; }
        if (cutoff !== null && eventTime > cutoff) { issues.push('FUTURE_EVENT'); invalid = true; }
        if (assigned !== null && eventTime < assigned) { issues.push('EVENT_BEFORE_ASSIGNMENT'); invalid = true; }
        if (field === 'exposed_at') hasExposure = true;
        if (field === 'submitted_at' && assigned !== null && eventTime >= assigned && eventTime <= assigned + 1_800_000 && eventTime <= cutoff) success = true;
      }
      const exposed = timestamp(row.exposed_at), submitted = timestamp(row.submitted_at);
      if (exposed !== null && submitted !== null && submitted < exposed) { issues.push('SUBMISSION_BEFORE_EXPOSURE'); invalid = true; }
    }
    if (!hasExposure) result.missingExposure++;
    if (invalid || cutoff === null || (assigned !== null && assigned > cutoff)) arm.unknown++;
    else if (assigned + 1_800_000 > cutoff) arm.pending++;                                                          
    else if (safeDataset.coverageComplete !== true || coverage === null || coverage < assigned + 1_800_000) arm.unknown++;
    else if (success) arm.success++;
    else if (unknown) arm.unknown++;
    else arm.nonSubmission++;                                                           
  }
  if (result.missingExposure) warnings.push('MISSING_EXPOSURE_RETAINED_IN_ITT');
  if (counts.A.pending + counts.B.pending) need.push('PENDING_OBSERVATION_WINDOW');
  if (counts.A.unknown + counts.B.unknown) need.push('UNKNOWN_OUTCOMES');
  if (v2 && counts.A.invalid + counts.B.invalid) need.push('QUALITY_FAILURES');                                     
  result.srmP = srm(counts.A.assigned, counts.B.assigned);
  if (result.srmP === null) need.push('SRM_NOT_COMPUTABLE');
  else if (result.srmP < 0.001) issues.push('SRM_FAILED');
  result.sampleSufficient = counts.A.assigned >= plan.requiredPerArm && counts.B.assigned >= plan.requiredPerArm;
  if (!result.sampleSufficient) need.push('INSUFFICIENT_SAMPLE');
  const fullyObserved = ['A', 'B'].every(arm => counts[arm].assigned > 0 && counts[arm].pending === 0 && counts[arm].unknown === 0 && !counts[arm].invalid);
  if (fullyObserved && issues.length === 0 && !need.includes('PENDING_FIXED_HORIZON') && !need.includes('INCOMPLETE_FIXED_HORIZON_COVERAGE')) {
    result.rates = { A: counts.A.success / counts.A.assigned, B: counts.B.success / counts.B.assigned };
    if (proportionTest(counts.A, counts.B) === null) need.push('DEGENERATE_STATISTICS');
  }
  if (issues.length) result.evidenceStatus = 'Stop / Blocked';
  else if (need.length) result.evidenceStatus = 'Need More Evidence';
  else {
    result.statistics = proportionTest(counts.A, counts.B);
    result.evidenceStatus = 'Synthetic Evidence Checked';
    result.statisticalStatus = 'Computable — Synthetic Only';
  }
  result.issues = [...new Set(issues)]; result.need = [...new Set(need)];
  return deepFreeze(result);
}
