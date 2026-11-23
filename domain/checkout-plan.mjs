                                                                                                                                        
export const METRIC = Object.freeze({
  id: 'PAYMENT_SUBMISSION_30M_ITT', version: 1, windowMinutes: 30,
  unit: 'eligible_assigned_unique_checkout',
});
export const METHOD = 'fixed_horizon_two_proportion_z_v1';
export const ASSIGNMENT = 'fnv1a_checkout_50_50_v1';
                                                                                         
                                                                                         
export const METRICS = Object.freeze({
  PAYMENT_SUBMISSION_30M_ITT: Object.freeze({ ...METRIC, success: 'submitted' }),
  PAYMENT_AUTH_APPROVAL_60M_ITT: Object.freeze({ id: 'PAYMENT_AUTH_APPROVAL_60M_ITT', version: 1, windowMinutes: 60, unit: 'eligible_assigned_unique_checkout', success: 'approved' }),
});
export const PLAN_V1 = 'pcl-checkout-plan-v1', PLAN_V2 = 'pcl-checkout-plan-v2';
                                                                                                                             
                                                                           
export const BINDING_FIELDS = Object.freeze(['problemId', 'problemFingerprint', 'hypothesisId', 'hypothesisStatement', 'treatment', 'segment', 'guardrailsFingerprint']);
                                                                                                                                     
export const isLegacyPlan = plan => !!plan && plan.schema === PLAN_V1;

export function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  const canonical = value.includes('.') ? value : value.replace('Z', '.000Z');
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === canonical ? parsed : null;
}

export function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

export async function fingerprint(value) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}

                                                                        
export function requiredPerArm(baselineRate, mdePP, alpha = 0.05, power = 0.8, allocation = 0.5) {
  if (![baselineRate, mdePP, alpha, power, allocation].every(Number.isFinite) ||
      baselineRate <= 0 || baselineRate >= 1 || mdePP <= 0 || baselineRate + mdePP / 100 >= 1) {
    throw new Error('Baseline and MDE must define two non-degenerate probabilities.');
  }
  if (alpha !== 0.05 || power !== 0.8 || allocation !== 0.5) {
    throw new Error('This approved method supports alpha .05, power .80 and allocation 50:50 only.');
  }
  const n = Math.ceil(2 * (1.9599639845 + 0.8416212336) ** 2 * baselineRate * (1 - baselineRate) / (mdePP / 100) ** 2);
  if (!Number.isSafeInteger(n)) throw new Error('Sample size is outside the supported numeric range.');
  return n;
}

export function assignCheckout(experimentId, checkoutId, seed = 'pcl-demo-v2') {
  if (![experimentId, checkoutId, seed].every(x => typeof x === 'string' && x.length > 0)) throw new Error('Assignment requires experiment, checkout and seed identities.');
  let hash = 2166136261;
  for (const c of `${seed}|${experimentId}|${checkoutId}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash % 2 === 0 ? 'A' : 'B';
}

export async function freezePlan(input) {
  if (input?.schema === PLAN_V2 || input?.binding !== undefined) return freezePlanV2(input);
  const plan = {
    schema: 'pcl-checkout-plan-v1', status: 'Frozen',
    experimentId: input.experimentId, experimentRevision: input.experimentRevision,
    problemId: 'P-01', hypothesisId: 'H-11', treatment: 'lean_form',
    planVersion: input.planVersion, metricId: METRIC.id, metricVersion: METRIC.version,
    baselineRate: input.baselineRate, mdePP: input.mdePP,
    alpha: input.alpha ?? 0.05, power: input.power ?? 0.8, allocation: input.allocation ?? 0.5,
    observationWindowMinutes: 30, analysisMethod: METHOD,
    assignmentAlgorithm: ASSIGNMENT, assignmentSeed: 'pcl-demo-v2',
    eligibilityVersion: 'checkout-demo-eligible-v1',
    enrollmentStart: input.enrollmentStart, enrollmentEnd: input.enrollmentEnd,
    stoppingRule: 'fixed_enrollment_end_then_30m_and_complete_coverage',
    frozenAt: input.frozenAt, source: 'Synthetic',
    preregistration: 'Synthetic planning replay; not verified real pre-registration',
  };
  if (typeof plan.experimentId !== 'string' || !plan.experimentId.trim() || !Number.isSafeInteger(plan.experimentRevision) || plan.experimentRevision < 1 ||
      !Number.isSafeInteger(plan.planVersion) || plan.planVersion < 1) throw new Error('Experiment revision and Plan Version are required positive integers.');
  const start = timestamp(plan.enrollmentStart), end = timestamp(plan.enrollmentEnd);
  if (start === null || end === null || end < start || timestamp(plan.frozenAt) === null) throw new Error('Valid UTC enrollment horizon and freeze timestamp are required.');
  plan.requiredPerArm = requiredPerArm(plan.baselineRate, plan.mdePP, plan.alpha, plan.power, plan.allocation);
  return deepFreeze({ ...plan, fingerprint: await fingerprint(plan) });
}

                                                                                                                              
                                                                         
async function freezePlanV2(input) {
  const metric = METRICS[input.metricId];
  if (!metric || input.metricVersion !== undefined && input.metricVersion !== metric.version) throw new Error('A known metric and version are required.');
  const b = input.binding ?? {};
  for (const k of BINDING_FIELDS) {
    if (k === 'segment') { if (!(b.segment === null || (b.segment && typeof b.segment.dim === 'string' && b.segment.dim && typeof b.segment.value === 'string' && b.segment.value))) throw new Error('The binding needs a segment (or null for all checkouts).'); }
    else if (typeof b[k] !== 'string' || !b[k].trim()) throw new Error(`The binding needs ${k}.`);
  }
  const binding = Object.fromEntries(BINDING_FIELDS.map(k => [k, k === 'segment' ? (b.segment ? { dim: b.segment.dim, value: b.segment.value } : null) : b[k]]));
  const plan = {
    schema: PLAN_V2, status: 'Frozen',
    experimentId: input.experimentId, experimentRevision: input.experimentRevision, planVersion: input.planVersion, binding,
    metricId: metric.id, metricVersion: metric.version,
    baselineRate: input.baselineRate, mdePP: input.mdePP,
    alpha: input.alpha ?? 0.05, power: input.power ?? 0.8, allocation: input.allocation ?? 0.5,
    observationWindowMinutes: metric.windowMinutes, analysisMethod: METHOD,
    assignmentAlgorithm: ASSIGNMENT, assignmentSeed: 'pcl-demo-v2',
    eligibilityVersion: 'checkout-demo-eligible-v1',
    enrollmentStart: input.enrollmentStart, enrollmentEnd: input.enrollmentEnd,
    stoppingRule: `fixed_enrollment_end_then_${metric.windowMinutes}m_and_complete_coverage`,
    frozenAt: input.frozenAt, source: 'Synthetic',
    preregistration: 'Synthetic planning replay; not verified real pre-registration',
  };
  if (typeof plan.experimentId !== 'string' || !plan.experimentId.trim() || !Number.isSafeInteger(plan.experimentRevision) || plan.experimentRevision < 1 ||
      !Number.isSafeInteger(plan.planVersion) || plan.planVersion < 1) throw new Error('Experiment revision and Plan Version are required positive integers.');
  const start = timestamp(plan.enrollmentStart), end = timestamp(plan.enrollmentEnd);
  if (start === null || end === null || end < start || timestamp(plan.frozenAt) === null) throw new Error('Valid UTC enrollment horizon and freeze timestamp are required.');
  plan.requiredPerArm = requiredPerArm(plan.baselineRate, plan.mdePP, plan.alpha, plan.power, plan.allocation);
  return deepFreeze({ ...plan, fingerprint: await fingerprint(plan) });
}

export async function validatePlan(plan) {
  if (!plan) return ['MISSING_PLAN'];
  try {
    const rebuilt = await freezePlan(plan);
    if (canonical(rebuilt) !== canonical(plan)) return ['INVALID_OR_MODIFIED_PLAN'];
    return [];
  } catch (error) { return ['INVALID_PLAN: ' + error.message]; }
}

export function evidenceCurrent(evidence, plan, context) {
  if (plan?.schema === PLAN_V2) return evidenceCurrentV2(evidence, plan, context);
  return !!evidence && !!plan && !!context &&
    evidence.binding.planFingerprint === plan.fingerprint &&
    evidence.binding.planVersion === plan.planVersion &&
    evidence.binding.experimentId === context.experimentId &&
    evidence.binding.experimentRevision === context.experimentRevision &&
    plan.experimentId === context.experimentId && plan.experimentRevision === context.experimentRevision &&
    context.problemId === 'P-01' && context.hypothesisId === 'H-11' && context.treatment === 'lean_form';
}

                                                                                                                           
                                                                                                                                      
function evidenceCurrentV2(evidence, plan, context) {
  if (!evidence || !plan || !context) return false;
  const e = evidence.binding;
  return e.planFingerprint === plan.fingerprint && e.planVersion === plan.planVersion && e.metricId === plan.metricId && e.metricVersion === plan.metricVersion &&
    e.experimentId === context.experimentId && e.experimentRevision === context.experimentRevision &&
    plan.experimentId === context.experimentId && plan.experimentRevision === context.experimentRevision && plan.metricId === context.metricId &&
    BINDING_FIELDS.every(k => canonical(plan.binding[k] ?? null) === canonical(context[k] ?? null));
}
