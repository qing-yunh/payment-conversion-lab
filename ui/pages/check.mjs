                             
                                                                                                                      
                                                                                                                        
import { CHECK, DIMS, METRICS, checkChange, dailySeries, dataRange, daysBetween, segFilter } from '../../engine/analytics.mjs';
import { checkCount, opportunityFor, segLabel } from '../../store/store.mjs';
import { db, head, needData, shell, tour, ui } from '../app.mjs';
import { lineChart, rateSeries } from '../charts.mjs';
import { dayLabel, esc, icon, num, pp, pval, rate } from '../format.mjs';

export const checkDefaults = () => ({ metric: 'submission', dim: '', value: '', date: '', days: CHECK.defaultDays, ran: null });
const segmentOf = c => (c.dim && c.value ? { dim: c.dim, value: c.value } : null);
                                                             
export const checkParams = c => ({ metric: c.metric, segment: segmentOf(c), date: c.date, days: Number(c.days) });
const HEADLINE = {
  worse: ['fail', 'Significantly lower, reaching the 1 pp threshold'],
  'worse-below-threshold': ['warn', 'Significantly lower, but below the 1 pp threshold for an opportunity'],
  improved: ['pass', 'Significantly higher after the date'],
  'no-change': ['', 'No significant change detected'],
  'cannot-test': ['warn', 'This check cannot be tested reliably'],
};
const range = w => `${dayLabel(w[0])} – ${dayLabel(w[1])}`;

export function checkPage() {
  if (!db) return needData('findings');
  const c = ui.check ??= checkDefaults(), r0 = dataRange(db), n = checkCount(db);
  const sel = (bind, opts, value, label) => `<label class="field">${label}<select data-bind="check.${bind}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const values = c.dim ? Object.entries(DIMS[c.dim].values).filter(([v]) => v !== 'n/a') : [];
  const form = `<section class="panel controls" aria-label="What to check">
    ${sel('metric', Object.entries(METRICS).map(([k, m]) => [k, m.label]), c.metric, 'Metric')}
    ${sel('dim', [['', 'All checkouts'], ...Object.entries(DIMS).map(([k, d]) => [k, d.label])], c.dim, 'Segment')}
    ${c.dim ? sel('value', [['', 'Choose…'], ...values], c.value, DIMS[c.dim].label) : ''}
    <label class="field">Change date<input type="date" data-bind="check.date" value="${esc(c.date)}" min="${r0.first}" max="${r0.last}"></label>
    <label class="field">Days on each side<input type="number" name="check-days" data-bind="check.days" min="${CHECK.minDays}" max="366" step="1" value="${esc(c.days)}"></label>
    <button class="btn primary" type="button" data-act="run-check">Run the check</button>
    <p class="small muted" style="flex-basis:100%">Use the exact date the change started, such as a release or a campaign start. A date a week late makes a real change noticeably harder to detect. The default window is ${CHECK.defaultDays} days on each side.</p></section>`;
  const intro = `<div class="callout section"><b>One question, asked before looking</b>This runs a single test of one metric and segment, before and after one date, with no correction for testing many things at once. That is only valid for a question you had before looking at the data. If you try several dates, metrics or segments after looking, treat what you find as exploratory, not as a confirmed change.
    <p class="small muted" style="margin:6px 0 0">Checks run in this workspace so far: <b data-check-count>${num(n)}</b>. The count is shown for transparency; it does not correct for trying several checks.${tour ? ' Checks in the tour are not counted.' : ''}</p></div>`;
  return shell('findings', `<div class="context"><a href="#/findings">Findings</a>${icon('chev')}<span>Check a specific change</span></div>${head('Check a specific change')}${intro}${form}${c.ran ? result(c.ran, c) : ''}`);
}

function result(ran, c) {
  let r;
  try { r = checkChange(db, checkParams(ran)); }
  catch (error) { return `<div class="callout fail section" data-check-result data-status="input-error" data-ran="${esc([ran.metric, ran.dim, ran.value, ran.date, ran.days].join('|'))}"><b>The check could not run</b>${esc(error.message)}</div>`; }
  const m = METRICS[r.metric], seg = segLabel(r.segment), [tone, title] = HEADLINE[r.status], ranKey = esc([ran.metric, ran.dim, ran.value, ran.date, ran.days].join('|'));
  const stale = ['metric', 'dim', 'value', 'date'].some(k => String(c[k]) !== String(ran[k])) || Number(c.days) !== Number(ran.days);
  const what = `${m.label} · ${seg} · change date ${ran.date ? dayLabel(ran.date) : '—'}`;
  if (r.status === 'cannot-test') return `<section class="section stack" data-check-result data-status="cannot-test" data-ran="${ranKey}">${stale ? staleNote : ''}
    <div class="callout warn"><b>${title}</b>${esc(what)}. ${r.reasons.map(esc).join(' ')} No p-value is shown, because the test would not mean anything here; this is not a finding of "no change".</div>
    ${r.window ? windowNote(r) : ''}</section>`;

  const t = r.test, lower = t.diff < 0, drop = -t.diff;
                                                                                                       
  const said = `${m.label} on ${seg.toLowerCase()} was ${rate(t.p2)} from ${range(r.window.cur)} and ${rate(t.p1)} from ${range(r.window.base)}: ${pp(t.diff, 1)} (95% interval ${pp(t.ci[0], 1)} to ${pp(t.ci[1], 1)}).`;
  const mde = pp(r.mde, 2).replace(/^\+/, '');
  const meaning = {
    worse: `The drop is statistically significant and at least ${CHECK.minDropPP} pp, the threshold for opening an opportunity.`,
    'worse-below-threshold': `Statistically significant, but smaller than the ${CHECK.minDropPP} pp business threshold for opening an opportunity. The 95% interval (${pp(t.ci[0], 1)} to ${pp(t.ci[1], 1)}) shows how large the true difference could be.`,
    improved: 'The rate is significantly higher after the date. This is not a problem to open as an opportunity.',
    'no-change': `No significant difference. With this window, changes smaller than about ${mde} often go undetected, so this does not show that nothing changed.`,
  }[r.status];
                                                                                                                                               
  const most = Math.min(daysBetween(dataRange(db).first, r.date) - 1, daysBetween(r.date, dataRange(db).last));
  let longer = '';
  if (r.status !== 'worse' && r.mde * 100 > CHECK.minDropPP && most > r.days) {
    const l = checkChange(db, { metric: r.metric, segment: r.segment, date: r.date, days: most });
    if (l.mde && l.mde < r.mde) longer = `<p class="small" data-longer-days="${most}">With ${most} days on each side, the most this data allows, the minimum detectable change would be about ${pp(l.mde, 2).replace(/^\+/, '')}. A longer window only helps if nothing else changed in that time.</p>`;
  }
  const o = r.status === 'worse' ? opportunityFor(db, r) : null;
  const action = r.status !== 'worse' ? '' : o ? `<p class="callout small" style="margin:0" data-open-as="${o}"><b>Already open as ${o}</b>${o} covers the same problem (${esc(m.label.toLowerCase())}, ${esc(seg.toLowerCase())}). It keeps the numbers it was opened with.</p><a class="btn primary" href="#/opportunities/${o}">Go to ${o} ${icon('chev')}</a>`
    : `<button class="btn primary" data-act="open-check-opp">Open as opportunity ${icon('chev')}</button>`;
  const daily = dailySeries(db, segFilter(r.segment), r.window.base[0], r.window.cur[1]);
  return `<div class="main-side section" data-check-result data-ran="${ranKey}" data-status="${r.status}" data-mde="${r.mde}" data-days="${r.days}" data-requested="${r.requestedDays}"><div class="stack">${stale ? staleNote : ''}
      <div class="callout ${tone}"><b>${title}</b>${esc(what)}. ${esc(said)} ${esc(meaning)}</div>
      <p class="callout small" style="margin:0"><b>A comparison of two periods, not a cause</b>This shows that the rate differed before and after the date. It does not show why: traffic mix, the days of the week, campaigns or other changes in the same weeks can all explain a difference. Treat it as a question to investigate; an experiment is what tests a fix.</p>
      <section class="panel pad"><h2>${esc(m.label)}, 7-day rolling</h2>${lineChart({ series: [{ label: seg, color: 'var(--s1)', points: rateSeries(daily, r.metric, true) }], shade: r.window.cur, markers: [{ day: r.date, label: 'Checked date ' + dayLabel(r.date) }], label: `${m.label} for ${seg}, before and after ${dayLabel(r.date)}` })}
        <p class="small muted">Shaded: the ${r.days} days from the checked date. The ${r.days} days before it are the comparison.</p></section>
      ${windowNote(r)}</div>
    <aside class="stack"><section class="panel pad stack"><h2>Evidence</h2><dl class="kv small" style="grid-template-columns:1fr auto">
      <dt>Before</dt><dd class="right">${rate(t.p1)} (${num(r.base[m.den])})</dd><dt>After</dt><dd class="right">${rate(t.p2)} (${num(r.cur[m.den])})</dd>
      <dt>Difference</dt><dd class="right">${pp(t.diff)}</dd><dt>95% interval</dt><dd class="right">${pp(t.ci[0], 1)} to ${pp(t.ci[1], 1)}</dd><dt>p-value (single test)</dt><dd class="right">${pval(t.p)}</dd>
      <dt>Minimum detectable change</dt><dd class="right">${mde}</dd>${lower ? `<dt>Weekly impact</dt><dd class="right">≈ ${num(r.lostPerWeek)}</dd>` : ''}</dl>
      <p class="small muted" style="margin:0">Minimum detectable change: the smallest true difference this window finds 80% of the time at two-sided 5% significance.${lower ? ` Weekly impact: the drop (${pp(drop, 2).replace(/^\+/, '')}) × checkouts per week after the date, counting only days that have data; an estimate, not a measured loss.` : ''}${r.small ? ` Fewer than ${CHECK.smallDenominator} in the denominator after the date: the result is unstable.` : ''}</p>
      ${longer}${action}</section></aside></div>`;
}
const staleNote = '<p class="callout warn small" style="margin:0"><b>The form has changed</b>The result below is for the check as last run. Run the check again to see the new settings.</p>';
                                                                           
function windowNote(r) {
  const miss = r.missingDays ?? { base: 0, cur: 0 };
  return `<section class="panel pad small stack" data-window-note><h2>What was compared</h2>
    <p style="margin:0">Before: ${range(r.window.base)}. After: ${range(r.window.cur)}. Requested ${r.requestedDays} days on each side; used ${r.days}${r.shortened ? ', shortened because the data does not reach further' : ''}.</p>
    <p style="margin:0">Days with no data at all: ${miss.base} before, ${miss.cur} after.</p>
    <p class="muted" style="margin:0">Coverage limit: a day with no data at all is treated as missing, and weekly figures use only the days that have data. A segment with no checkouts on a day that has data counts as a real zero. This is an assumption about the current synthetic sample; imported data will need it checked again.</p></section>`;
}
