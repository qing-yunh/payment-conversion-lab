                                                                                                         
                                                                                                                         
import { requiredPerArm } from '../domain/checkout-plan.mjs';
import { stopCondition } from './results.mjs';

const pp = (x, dp = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(dp)} pp`;
const n0 = n => Math.round(n).toLocaleString('en-GB');
const gbp = minor => '£' + Math.round(minor / 100).toLocaleString('en-GB');

                                                                                                  
                                                                                                                                 
const day = ms => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
function dataActions(ev, plan, { shortfall, daily, explicitUnknown }) {
  const has = code => ev.need.some(n => n.split(':')[0] === code), out = [], push = (title, text) => out.push({ tone: 'check', title, text });
  const win = plan.observationWindowMinutes ?? 30;                                                      
  const unconfirmed = has('UNKNOWN_EVENT_COVERAGE'), horizonEnd = Date.parse(plan.enrollmentEnd) + win * 60_000, cov = Date.parse(ev.coverageThrough ?? '');
  const short = Number.isFinite(cov) && cov < horizonEnd;
  if (has('PENDING_FIXED_HORIZON')) push('Wait for the fixed horizon', `Enrolment has not closed plus ${win} minutes. Reading the result earlier would be an early peek.`);
  if (unconfirmed) push('Confirm the export is complete', 'Completeness was not confirmed at import, so a checkout with no submission cannot be told apart from a missing event, and every outcome stays unconfirmed. Import again and tick the box only when every event up to the cut-off is in the file.');
  if (has('INCOMPLETE_FIXED_HORIZON_COVERAGE') && short) push('Export through the horizon', `The file covers events up to ${day(cov)}; the plan needs them up to ${day(horizonEnd)} (enrolment end plus ${win} minutes). Export again with a later cut-off.`);
  if (has('PENDING_OBSERVATION_WINDOW')) push(`Wait for the ${win}-minute window`, 'Some checkouts are still inside their observation window.');
  if (has('UNKNOWN_OUTCOMES')) {
    if (explicitUnknown > 0) push('Resolve unknown outcomes', `${n0(explicitUnknown)} row${explicitUnknown > 1 ? 's are' : ' is'} marked outcome_known = false. Fill them from the source system, or wait until they settle.`);
    else if (!unconfirmed && !short) push('Find the unconfirmed checkouts', 'Some checkouts cannot be classified yet. The import check lists the rows concerned; correct them in the export.');
  }
  if (has('INSUFFICIENT_SAMPLE')) push('Run longer', `${shortfall > 0 ? `${n0(shortfall)} more checkouts per group are needed for the planned sample${daily ? `, about ${Math.ceil(shortfall * 2 / daily)} more days at current traffic` : ''}.` : 'The planned sample is not reached in both groups yet.'} A later end date is a plan change: freeze a new plan version before the extra days start, never after looking at the data.`);
  if (has('SRM_NOT_COMPUTABLE')) push('Check the assignment', 'One group is empty, so the split cannot be checked.');
  if (has('DEGENERATE_STATISTICS')) push('Check the metric', 'Every checkout has the same outcome, so no comparison is possible.');
  if (!out.length) push('Review the import checks', 'The evidence is not checked yet; the import panel lists what is missing.');
  return out;
}

   
                    
                                                    
                                                
                                           
                                                                                        
                                                                                                                      
                                                                        
                                                        
                                                                            
                                                                                                
                                                                                                             
   
export function nextSteps({ evidence: ev, analysis: a, plan, assumedPP = null, alternatives = [], missingEvidence = [], daily = 0, labels = {}, explicitUnknown }) {
  const out = [], alt = alternatives[0], altStep = verb => alt && out.push({ tone: 'consider', title: `${verb}: ${alt.title}`,
    text: `${alt.kind}${alt.valueMid !== null ? `, estimated ${gbp(alt.valueMid)} a week at the middle of its assumptions` : ''}. It works on the same problem by a different route.`, href: alt.href, link: 'Compare options' });
  if (ev.evidenceStatus === 'Stop / Blocked') {
    out.push({ tone: 'avoid', title: 'Fix the data before reading anything', text: `The import failed these checks: ${ev.issues.map(i => i.toLowerCase().replace(/_/g, ' ')).join('; ')}. Correct the export and import it again.` });
    return out;
  }
  if (ev.evidenceStatus !== 'Synthetic Evidence Checked') {
    const shortfall = plan.requiredPerArm - Math.min(ev.counts.A.assigned, ev.counts.B.assigned);
    out.push(...dataActions(ev, plan, { shortfall, daily, explicitUnknown }));
    out.push({ tone: 'avoid', title: 'Do not read the difference yet', text: 'Rates and differences stay hidden until these checks pass, so an early number cannot steer the decision.' });
    return out;
  }
  const s = ev.statistics, diff = s.difference * 100, lo = s.ci95[0] * 100, hi = s.ci95[1] * 100;
  const fails = a.guardrails.filter(g => g.verdict === 'Fail'), carried = a.guardrails.filter(g => g.carry);
  if (fails.length) {
    out.push({ tone: 'avoid', title: 'Do not take B forward as it is', text: `${fails.map(g => g.label).join(' and ')} got worse beyond the tolerance. A gain on ${plan.metricId === 'PAYMENT_AUTH_APPROVAL_60M_ITT' ? 'authorisation conversion' : 'submission'} does not offset that.` });
    out.push({ tone: 'check', title: `Find out why ${fails.map(g => g.label.toLowerCase()).join(' and ')} fell`, text: 'Compare decline reasons and order values by group; a shorter form can drop data the issuer or fraud tools rely on.' });
    if (lo > 0) out.push({ tone: 'consider', title: 'Design a B that keeps the gain without the harm', text: 'Restore the fields the guardrail depends on. A changed B is a new treatment revision: it needs its own treatment design review and a new frozen plan before it is tested.' });
    return out;
  }
  if (lo > 0) {
    out.push({ tone: 'do', title: 'Prepare a real experiment', text: `Get sign-off from the checkout, payments and risk owners, then run B on real traffic with a fixed horizon.${carried.length ? ` Carry these stop conditions: ${carried.map(stopCondition).join('; ')}.` : ''}` });
    if (assumedPP) {
      const [x, y] = assumedPP, where = diff < x ? 'below' : diff > y ? 'above' : 'inside';
                                                                                                                  
      const synthetic = /^Synthetic/.test(ev.evidenceStatus);
      out.push({ tone: 'check', title: 'Compare with the estimate', text: `Observed ${pp(diff, 2)} is ${where} the assumed ${pp(x)} to ${pp(y)}.${synthetic ? ' This result is synthetic: it shows how the check works and is not a reason to change the estimate. Revise the assumption only from a real experiment.' : where === 'inside' ? ' Keep the assumption, and narrow it once a real test reports.' : ' Revise the assumption before using the value estimate in planning.'}` });
    }
    const segs = (a.segments.payment_method ?? []).filter(r => r.test && r.a[1] >= 300 && r.b[1] >= 300).sort((p, q) => q.test.diff - p.test.diff);
    if (segs.length > 1) {
      const top = segs[0], low = segs[segs.length - 1];
      out.push({ tone: 'consider', title: 'Look at where the gain is smallest', text: `Exploratory only: ${labels[top.value] ?? top.value} ${pp(top.test.diff * 100)} vs ${labels[low.value] ?? low.value} ${pp(low.test.diff * 100)}. If the gap matters, pre-register it as a segment in the real test rather than reading it from this one.` });
    }
    altStep('Next to test');
    return out;
  }
  if (hi < 0) {
    out.push({ tone: 'avoid', title: 'Stop this option', text: `B lowered ${plan.metricId === 'PAYMENT_AUTH_APPROVAL_60M_ITT' ? 'authorisation conversion' : 'submission'} by ${pp(Math.abs(diff), 2).replace('+', '')}; the whole interval is below zero.` });
    out.push({ tone: 'check', title: 'Find where B loses shoppers', text: 'Compare field errors and time on the payment step by group before redesigning; the funnel below shows the step.' });
    altStep('Try instead');
    return out;
  }
  out.push({ tone: 'avoid', title: 'Do not prepare a real test of B on this evidence', text: `The interval ${pp(lo, 2)} to ${pp(hi, 2)} includes zero.` });
  if (missingEvidence.length) out.push({ tone: 'check', title: 'Confirm the cause before the next test', text: `Still unchecked: ${missingEvidence.slice(0, 3).join('; ').toLowerCase()}.` });
  const half = +(plan.mdePP / 2).toFixed(2);
  try {
    const need = requiredPerArm(plan.baselineRate, half);
    out.push({ tone: 'consider', title: `Only if ${half} pp would still be worth it: plan a bigger test`, text: `Detecting ${half} pp needs ${n0(need)} checkouts per group${daily ? `, about ${Math.ceil(2 * need / daily)} days at current traffic` : ''}. That is a new plan version, frozen before enrolment starts. If it is too slow, a smaller effect is not worth chasing here.` });
  } catch {                                                              }
  altStep('Try instead');
  return out;
}
