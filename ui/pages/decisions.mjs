                                                                          
import { experimentState } from '../../store/db.mjs';
import { decisionSnapshot, decisions } from '../../store/store.mjs';
import { db, evidenceState, head, isVoid, needData, notFound, shell } from '../app.mjs';
import { esc, num, pill, pp, pval } from '../format.mjs';
import { SOURCE_TEXT, overrides, sourceOf } from './experiment.mjs';

export function decisionsPage() {
  if (!db) return needData('decisions');
  const list = decisions(db);
  return shell('decisions', `${head('Decisions')}${list.length ? `<section class="panel"><table class="data"><thead><tr><th>ID</th><th>Experiment</th><th>Verdict</th><th>Next step</th><th>Written by</th><th>Recorded</th></tr></thead><tbody>${list.map(d => { const cur = experimentState(db, d.experiment_id).decision_id === d.decision_id, next = list.filter(x => x.experiment_id === d.experiment_id && x.seq > d.seq).sort((x, y) => x.seq - y.seq)[0];                                                 
    return `<tr class="voidable ${cur ? '' : 'is-void'}"><td class="mono"><a href="#/decisions/${d.decision_id}" title="Open the record as it was made">${d.decision_id}</a></td><td><a href="#/experiments/${d.experiment_id}/decision">${esc(d.title)}</a></td><td>${!cur ? `<span class="small" style="color:var(--void);font-weight:600">${next ? `Superseded by ${next.decision_id}` : 'No longer current'}</span>` : isVoid(d.evidence_id) ? (evidenceState(d.evidence_id) === 'historical' ? pill('unknown', `${d.verdict} · historical, not a current approval`) : pill('fail', `${d.verdict} · evidence void`)) : pill(d.verdict === 'Planning Ready' ? 'pass' : 'warn', d.verdict)}${cur && overrides(d) ? `<div class="small" style="margin-top:4px">${pill('warn', 'Overrides results')}</div>` : ''}</td><td class="small">${esc(d.next_step)}</td><td class="small muted">${esc(d.authored_by ?? '—')}</td><td class="small muted">${new Date(d.decided_ms).toUTCString().slice(5, 16)}</td></tr>`; }).join('')}</tbody></table></section>`
    : `<div class="panel empty"><h2>No decisions yet</h2><p>A decision is recorded at the end of an experiment, once its evidence and both reviews are in.</p></div>`}`);
}

                                                                                                    
                                                                                                        
const when = ms => (ms ? new Date(ms).toUTCString().slice(5, 22) + ' UTC' : '—');
const fp = h => `<span class="mono" title="${esc(h)}">${esc(String(h ?? '—').slice(0, 16))}…</span>`;
export function decisionSnapshotPage(id) {
  if (!db) return needData('decisions');
  const snap = decisionSnapshot(db, id);
  if (!snap) return notFound('decisions');
  const { decision: d, plan, evidence: ev, imported: im, designReview: dr, evidenceReview: er, current, later } = snap;
  const status = current ? (isVoid(d.evidence_id) ? (evidenceState(d.evidence_id) === 'historical' ? pill('unknown', 'Historical record · not a current approval') : pill('fail', 'Current · evidence now void')) : pill('pass', 'Current decision')) : pill('unknown', later.length ? `Superseded by ${later[0]}` : 'No longer current');
                                                                                                                              
                                                                                                                      
  const nowEvidence = experimentState(db, d.experiment_id)?.evidence_id, newerImport = nowEvidence && nowEvidence !== d.evidence_id;
  const why = current ? '' : later.length ? `A later decision (${later.join(', ')}) replaced this one; it is kept as the record of what was decided at the time.`
    : `This is no longer the current conclusion, and no later decision has been recorded yet.${newerImport ? ` Its evidence ${d.evidence_id} has since been replaced by ${nowEvidence} from a newer import.` : ''} It is kept as the record of what was decided at the time.`;
  const s = ev?.result_json?.statistics, counts = ev?.result_json?.counts;
  const checks = r => (r?.checks_json ?? []).map(c => `<li>${esc(c.label ?? c.id)}: ${c.verdict ? esc(c.verdict) : c.ok ? 'ticked' : 'not ticked'}${c.reason ? ` <span class="muted">· ${esc(c.reason)}</span>` : ''}</li>`).join('');
  return shell('decisions', `<div class="context"><a href="#/decisions">Decisions</a><span class="mono">&nbsp;/ ${esc(id)}</span></div>
    ${head(`Decision ${esc(id)} · as recorded`, status)}
    <p class="small muted section" style="margin-top:0">Read-only. These records are append-only, so this page shows them exactly as they were stored on ${esc(when(d.decided_ms))}. ${esc(why)}</p>
    <div class="grid2 section"><section class="panel pad stack"><h2>The decision</h2><dl class="kv">
      <dt>Experiment</dt><dd><a href="#/experiments/${esc(d.experiment_id)}/decision">${esc(d.experiment_id)}</a> · ${esc(d.title)}</dd>
      <dt>Verdict</dt><dd>${esc(d.verdict)}</dd>
      ${d.override_reason ? `<dt>Overrides the results recommendation</dt><dd>The results said “${esc(d.override_reading)}”. Reason: ${esc(d.override_reason)}</dd>` : ''}
      <dt>Why</dt><dd>${esc(d.rationale)}</dd>
      ${d.alternatives ? `<dt>Alternatives considered</dt><dd>${esc(d.alternatives)}</dd><dt>Still assumptions</dt><dd>${esc(d.assumptions)}</dd><dt>What would change my mind</dt><dd>${esc(d.change_my_mind)}</dd>` : ''}
      <dt>Next step</dt><dd>${esc(d.next_step)}</dd><dt>Written by</dt><dd>${esc(d.authored_by ?? '—')}</dd><dt>Recorded</dt><dd>${esc(when(d.decided_ms))}</dd></dl></section>
    <section class="panel pad stack"><h2>Plan v${esc(plan?.plan_version ?? '—')}</h2><dl class="kv">
      <dt>Fingerprint</dt><dd>${fp(d.plan_fingerprint)}</dd><dt>Primary metric</dt><dd>${esc(plan?.plan_json?.metricId ?? '—')}${plan?.plan_json?.schema === 'pcl-checkout-plan-v1' ? ' <span class="small muted">· plan frozen before plans recorded what they test</span>' : ''}</dd><dt>Smallest effect to detect</dt><dd>${esc(plan?.mde_pp ?? '—')} pp</dd>
      <dt>Needed per group</dt><dd>${plan ? num(plan.required_per_arm) : '—'}</dd><dt>Enrolment</dt><dd>${esc(plan?.plan_json?.enrollmentStart ?? '—')} to ${esc(plan?.plan_json?.enrollmentEnd ?? '—')}</dd>
      <dt>Frozen</dt><dd>${esc(when(plan?.frozen_ms))}</dd></dl></section></div>
    <div class="grid2 section"><section class="panel pad stack"><h2>Evidence ${esc(d.evidence_id ?? '—')}</h2><dl class="kv">
      <dt>Status</dt><dd>${esc(ev?.evidence_status ?? '—')}</dd>
      ${s ? `<dt>B − A</dt><dd>${pp(s.difference)} (95% CI ${pp(s.ci95[0])} to ${pp(s.ci95[1])}), p ${pval(s.pValue)}</dd>` : '<dt>B − A</dt><dd>Not reported: the evidence had not passed its checks</dd>'}
      ${counts ? `<dt>Successes / assigned</dt><dd>A ${num(counts.A?.success)} / ${num(counts.A?.assigned)} · B ${num(counts.B?.success)} / ${num(counts.B?.assigned)}</dd>` : ''}
      <dt>Data as of</dt><dd>${esc(when(ev?.as_of_ms))}</dd><dt>Dataset fingerprint</dt><dd>${fp(ev?.dataset_fingerprint)}</dd></dl></section>
    <section class="panel pad stack"><h2>Import</h2><dl class="kv">
      <dt>File</dt><dd>${esc(im?.file_name ?? '—')} · ${im ? num(im.row_count) : '—'} rows</dd><dt>Imported</dt><dd>${esc(when(im?.imported_ms))}</dd>
      <dt>Import fingerprint</dt><dd>${fp(im?.import_fingerprint)}</dd><dt>Analysis rules</dt><dd>${esc(im?.rules_version ?? '—')}</dd>
      <dt>Source</dt><dd>${im ? esc(SOURCE_TEXT[sourceOf(im.experiment_id)]) : '—'}</dd></dl></section></div>
    <div class="grid2 section"><section class="panel pad stack"><h2>Treatment design review ${esc(dr?.review_id ?? '')}</h2>${dr ? `<p>${pill(dr.outcome === 'Pass' ? 'pass' : 'fail', dr.outcome)} <span class="small muted">${esc(when(dr.created_ms))}</span></p><ul class="small">${checks(dr)}</ul>` : '<p class="muted">None was recorded for this decision.</p>'}</section>
    <section class="panel pad stack"><h2>Evidence review ${esc(er?.review_id ?? '')}</h2>${er ? `<p>${pill(er.outcome === 'Pass' ? 'pass' : 'fail', er.outcome)} <span class="small muted">${esc(er.evidence_level)} · ${esc(when(er.created_ms))}</span></p><ul class="small">${checks(er)}</ul>` : '<p class="muted">None was recorded for this decision.</p>'}</section></div>`);
}
