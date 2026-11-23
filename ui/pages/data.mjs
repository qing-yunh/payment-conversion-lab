                                                                     
import { METRICS, dataRange, rows } from '../../engine/analytics.mjs';
import { db, head, shell, tour } from '../app.mjs';
import { dayLabel, esc, num } from '../format.mjs';

export function dataPage() {
  if (tour) return shell('data', `${head('Data')}<div class="panel empty"><h2>You are in the tour's copy of the data</h2><p>Exit the tour to manage the data in your workspace. Nothing done in the tour is kept.</p><button class="btn primary" data-act="tour-exit">Exit tour</button></div>`);
  const r = db ? dataRange(db) : null, d = db ? rows(db, 'SELECT * FROM dataset WHERE ds = 1')[0] : null;
  return shell('data', `${head('Data')}<div class="grid2"><section class="panel pad stack"><h2>Checkout history</h2>${db ? `<dl class="kv small"><dt>Dataset</dt><dd class="mono">${esc(d.dataset_id)} v${d.version}</dd><dt>Source</dt><dd>Synthetic · generator ${esc(d.generator)} · seed ${esc(d.seed)}</dd>
      <dt>Coverage</dt><dd>${dayLabel(r.first)} – ${dayLabel(r.last)} 2026 (${r.days} days)</dd><dt>Rows</dt><dd>${num(rows(db, 'SELECT COUNT(*) n FROM checkout')[0].n)} checkouts · ${num(rows(db, 'SELECT COUNT(*) n FROM payment_attempt')[0].n)} attempts</dd></dl>` : '<p class="muted">No data loaded.</p>'}
      <form class="row" data-form="regen"><label class="field">Seed<input name="seed" value="${esc(d?.seed ?? 'pcl-sample-1')}"></label><label class="field">Checkouts a day<input name="daily" type="number" min="50" max="5000" value="700"></label><button class="btn" type="submit">${db ? 'Regenerate sample' : 'Load sample data'}</button></form>
      <p class="small muted">Importing your own transaction history arrives in the next release. Experiment results can be imported now, from each experiment’s Results tab.</p></section>
    <section class="panel pad stack"><h2>Privacy</h2><p class="small">Everything runs in this browser. Data is stored in this browser's IndexedDB and is never uploaded. Files containing card numbers are refused at import.</p>
      <h2 style="margin-top:20px">Reset</h2><p class="small muted">Deletes the database in this browser, including opportunities, experiments, imported results and decisions.</p><button class="btn danger" data-act="reset-ask">Reset all data</button></section></div>
    <dialog id="reset"><h2>Reset all data?</h2><p class="small" style="margin:8px 0 16px">This deletes the checkout history, opportunities, experiments, imported results, reviews and decisions stored in this browser.</p><div class="row"><button class="btn danger" data-act="reset">Reset all data</button><button class="btn" data-act="reset-cancel">Cancel</button></div></dialog>`);
}
export function helpPage() {
  return shell('help', `${head('Help')}<div class="grid2"><section class="panel pad stack"><h2>How it works</h2><ol class="small" style="padding-left:18px;margin:0">
    <li><b>Monitor</b> shows each rate with its numerator and denominator for any period and segment.</li><li><b>Findings</b> tests every segment for significant drops (Holm-adjusted), locates the onset and folds segments explained by a deeper one. It reports what was observed; causes stay hypotheses until you check the evidence it lists.</li>
    <li><b>Opportunities</b> turn a finding into options from a payments playbook, each with when it applies and an estimate from your data, using assumptions you can edit.</li><li><b>Experiments</b> freeze a plan (sample size, window, guardrails) before any result exists, then read imported results with data checks, SRM and confidence intervals.</li>
    <li><b>Risk and Decision</b> apply the guardrail rule and record a decision with alternatives, assumptions and what would change it, bound to the exact plan, evidence and reviews. The strongest verdict is Planning Ready, never "ship".</li></ol></section>
    <section class="panel pad stack"><h2>Definitions</h2><dl class="kv small">${Object.values(METRICS).map(m => `<dt>${m.label}</dt><dd>${m.def}</dd>`).join('')}<dt>Primary experiment metric</dt><dd>Each plan names one of two. <b>Payment submission</b>: a payment submitted within 30 minutes of assignment, per eligible checkout; retries count once; missing exposure stays in (ITT). <b>Authorisation conversion</b>: an approved authorisation within 60 minutes of assignment, not before the payment was submitted, per eligible checkout, counted once; missing exposure stays in (ITT).</dd>
      <dt>Guardrail verdicts</dt><dd>Pass: the 95% interval rules out harm beyond the tolerance. Fail: significantly worse and beyond it. Inconclusive: neither. Unknown: no or incomplete data.</dd></dl>
    <p class="note">Prefer a guided start? <a href="#/tour">Take the 5-minute tour</a>.</p></section></div>
    <section class="panel pad stack section" data-about><h2>About this project</h2><p class="small">Payment Conversion Lab is an interactive product case study by <b>Jingyun He</b>, exploring how to identify payment conversion problems, evaluate options and make evidence-based decisions. All data and experiment results are synthetic.</p>
<p class="small">My role: product direction, scope, metric definitions and decision boundaries. Built with AI assistance.</p>
      <p class="small muted">This demonstrates a decision-making process, not proven business growth or a production payment system.</p></section>`);
}
