                                                                         
                                                                                             
import { requiredPerArm } from '../domain/checkout-plan.mjs';
import { addDays, daysBetween, defaultWindows, segFilter, totals } from '../engine/analytics.mjs';

                                                                                                                      
export const metricOf = x => (x.primary_metric_id === 'PAYMENT_AUTH_APPROVAL_60M_ITT'
  ? { id: x.primary_metric_id, label: 'Authorisation conversion', short: 'authorisation conversion', window: 60, num: 'approved' }
  : { id: 'PAYMENT_SUBMISSION_30M_ITT', label: 'Payment submission', short: 'submission', window: 30, num: 'submitted' });
export function planNumbersIn(db, x, draft) {
  const w = defaultWindows(db), t = totals(db, segFilter(x.segment), ...w.cur), daily = t.started / daysBetween(...w.cur), base = t[metricOf(x).num] / t.started;
  const mde = Number(draft.mde), start = draft.start;
  let perArm = null, minDays = null, err = null;
  try { if (!(mde > 0)) throw new Error('Enter an MDE above 0.'); perArm = requiredPerArm(+base.toFixed(4), mde); minDays = Math.ceil(2 * perArm / daily); }
  catch (e) { err = e.message; }
  const days = Math.max(Number(draft.days) || 0, 1);
  return { t, daily, base, mde, perArm, minDays, days, start, end: start ? addDays(start, days - 1) : null, err, short: minDays && days < minDays };
}
