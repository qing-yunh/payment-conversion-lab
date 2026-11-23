                                                                        
import { DIMS, METRICS, addDays, breakdown, compare, dailySeries, dataRange, daysBetween, totals } from '../../engine/analytics.mjs';
import { db, head, needData, shell, tour, ui } from '../app.mjs';
import { COLORS, lineChart, rateSeries } from '../charts.mjs';
import { dayLabel, esc, num, pct, pp, pval, rate } from '../format.mjs';

                    
export function monitor() {
  if (!db) return needData('monitor');
  const m = ui.monitor, r = dataRange(db), len = daysBetween(m.from, m.to);
  const base = m.compare === 'previous' ? [addDays(m.from, -len), addDays(m.from, -1)] : null;
  const baseValid = base && base[0] >= r.first;
  const cur = totals(db, m.filters, m.from, m.to), prev = baseValid ? totals(db, m.filters, ...base) : null;
  const filterMenu = (dim, d) => `<details class="filter"><summary>${d.label}${m.filters[dim]?.length ? ` · ${m.filters[dim].length}` : ''}</summary><div class="menu">${Object.entries(d.values).map(([v, l]) =>
    `<label><input type="checkbox" data-filter="${dim}" value="${v}" ${m.filters[dim]?.includes(v) ? 'checked' : ''}>${l}</label>`).join('')}</div></details>`;
  const kpiRows = Object.entries(METRICS).map(([k, mm]) => {
    const t = prev ? compare(prev[mm.num], prev[mm.den], cur[mm.num], cur[mm.den]) : null, cls = !t ? 'flat' : t.p < 0.05 ? (t.diff > 0 ? 'up' : 'down') : 'flat';
    return `<tr><td><b>${mm.label}</b><div class="small muted">${mm.def}</div></td><td class="num val">${pct(cur[mm.num], cur[mm.den])}</td><td class="num ${cls}">${t ? pp(t.diff, 1) : '—'}${t ? `<div class="small muted">p ${pval(t.p)}</div>` : ''}</td><td class="num muted">${num(cur[mm.num])} / ${num(cur[mm.den])}</td></tr>`;
  }).join('');
  const from = tour && baseValid ? base[0] : m.from;                                                         
  const daily = dailySeries(db, m.filters, addDays(from, m.smooth ? -6 : 0) < r.first ? r.first : addDays(from, m.smooth ? -6 : 0), m.to, m.split || null);
  let series;
  if (m.split) {
    const keys = [...new Set(daily.map(x => x.k))];
    const hot = tour && m.split === tour.f.segment.dim ? tour.f.segment.value : null;
    series = keys.map((k, i) => ({ label: DIMS[m.split].values[k] ?? k, color: hot ? (k === hot ? 'var(--s1)' : ['var(--s2)', 'var(--s3)', 'var(--s5)'][i % 3]) : COLORS[i % 5], width: k === hot ? 2.75 : undefined, points: rateSeries(daily.filter(x => x.k === k), m.metric, m.smooth).filter(p => p[0] >= from) }));
  } else series = [{ label: 'All selected', color: 'var(--s2)', points: rateSeries(daily, m.metric, m.smooth).filter(p => p[0] >= from) }];
  const mm = METRICS[m.metric], br = breakdown(db, m.filters, m.dim, [m.from, m.to], baseValid ? base : null).map(b => {
    const t = b.base ? compare(b.base[mm.num], b.base[mm.den], b.cur[mm.num], b.cur[mm.den]) : null;
    return { ...b, label: DIMS[m.dim].values[b.key] ?? b.key, rate: b.cur[mm.den] ? b.cur[mm.num] / b.cur[mm.den] : null, t };
  }).sort((a, b) => m.sort === 'delta' ? (a.t?.diff ?? 0) - (b.t?.diff ?? 0) : m.sort === 'volume' ? b.cur[mm.den] - a.cur[mm.den] : (b.rate ?? 0) - (a.rate ?? 0));
  const quick = n => `<button class="btn small" data-act="range" data-days="${n}">${n} days</button>`;
  return shell('monitor', `${head('Monitor')}
    <section class="panel controls" aria-label="Filters"><label class="field">From<input type="date" data-bind="monitor.from" value="${m.from}" min="${r.first}" max="${m.to}"></label>
      <label class="field">To<input type="date" data-bind="monitor.to" value="${m.to}" min="${m.from}" max="${r.last}"></label><div class="row">${quick(7)}${quick(28)}${quick(90)}</div>
      <label class="field">Compare with<select data-bind="monitor.compare"><option value="previous" ${m.compare === 'previous' ? 'selected' : ''}>Previous ${len} days</option><option value="none" ${m.compare === 'none' ? 'selected' : ''}>No comparison</option></select></label>
      <div class="row">${Object.entries(DIMS).map(([k, d]) => filterMenu(k, d)).join('')}${Object.keys(m.filters).some(k => m.filters[k]?.length) ? '<button class="btn small" data-act="clear-filters">Clear filters</button>' : ''}</div></section>
    ${m.compare === 'previous' && !baseValid ? '<p class="note section">The comparison period starts before the data does, so changes are not shown. Choose a later start date.</p>' : ''}
    <section class="panel section"><div class="table-scroll"><table class="data"><thead><tr><th>Metric</th><th class="num">${dayLabel(m.from)} – ${dayLabel(m.to)}</th><th class="num">Change</th><th class="num">Numerator / denominator</th></tr></thead><tbody>${kpiRows}</tbody></table></div></section>
    <section class="panel pad section"><div class="row"><h2>Trend</h2><span class="spacer"></span>
      <label class="field">Metric<select data-bind="monitor.metric">${Object.entries(METRICS).map(([k, x]) => `<option value="${k}" ${m.metric === k ? 'selected' : ''}>${x.label}</option>`).join('')}</select></label>
      <label class="field">Split by<select data-bind="monitor.split"><option value="">No split</option>${Object.entries(DIMS).map(([k, d]) => `<option value="${k}" ${m.split === k ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label>
      <label class="field">Values<select data-bind="monitor.smooth"><option value="1" ${m.smooth ? 'selected' : ''}>7-day rolling</option><option value="0" ${m.smooth ? '' : 'selected'}>Daily</option></select></label></div>
      ${lineChart({ series, shade: from !== m.from ? [m.from, m.to] : undefined, markers: tour?.f.onset && from <= tour.f.onset ? [{ day: tour.f.onset, label: 'Change around ' + dayLabel(tour.f.onset) }] : [], label: `${mm.label} trend` })}</section>
    <section class="panel section"><div class="pad row"><h2>Breakdown</h2><span class="spacer"></span><label class="field">By<select data-bind="monitor.dim">${Object.entries(DIMS).map(([k, d]) => `<option value="${k}" ${m.dim === k ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label></div>
      <div class="table-scroll"><table class="data"><thead><tr><th>${DIMS[m.dim].label}</th><th class="num"><button data-act="sort" data-sort="rate">${mm.label}</button></th><th class="num"><button data-act="sort" data-sort="delta">Change${m.sort === 'delta' ? ' ↑' : ''}</button></th><th class="num">p</th><th class="num"><button data-act="sort" data-sort="volume">Denominator</button></th></tr></thead>
      <tbody>${br.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${rate(b.rate)}</td><td class="num ${b.t && b.t.p < 0.05 ? (b.t.diff > 0 ? 'up' : 'down') : 'flat'}">${b.t ? pp(b.t.diff, 1) : '—'}</td><td class="num muted">${b.t ? pval(b.t.p) : '—'}</td><td class="num muted">${num(b.cur[mm.den])}</td></tr>`).join('')}</tbody></table></div></section>`);
}
