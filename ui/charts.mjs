                     
import { METRICS } from '../engine/analytics.mjs';
import { dayLabel, esc, narrow } from './format.mjs';

                   
                                                                                                         
export function lineChart({ series, height = 220, width = 760, yFmt = v => (v * 100).toFixed(0) + '%', markers = [], shade = null, band = null, zero = false, label }) {
  const small = narrow();
  let font = small ? 13 : 11;
  if (small) width = 300;
  const days = [...new Set(series.flatMap(s => s.points.map(p => p[0])).concat(band ? band.map(b => b.day) : []))].sort();
  if (days.length < 2) return '<p class="muted small">Not enough days to draw a trend.</p>';
  const vals = series.flatMap(s => s.points.map(p => p[1])).concat(band ? band.flatMap(b => [b.lo, b.hi]) : []).filter(v => v !== null && Number.isFinite(v));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const span = (hi - lo) || 0.01, step = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1].find(s => span / s <= 5) ?? 0.2;
  lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi - lo < step * 2) hi = lo + step * 2;
  const x = d => days.indexOf(d) * width / (days.length - 1), y = v => height - (v - lo) / (hi - lo) * height;
  const ticks = []; for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);
                                                                                                                               
                                                                                                                                  
  const longest = Math.max(...ticks.map(t => String(yFmt(t)).length)), margin = f => Math.max(48, Math.ceil(longest * f * 0.62) + 12);
  let left = margin(font);
  for (let i = 0; small && i < 3; i++) { font = Math.max(13, 13 * (width + left + 12) / (width + 60)); left = margin(font); }
  const path = pts => pts.filter(p => p[1] !== null).map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
  const xl = [0, Math.floor(days.length / 2), days.length - 1].map((i, k) => `<text x="${x(days[i])}" y="${height + 18}" text-anchor="${['start', 'middle', 'end'][k]}">${dayLabel(days[i])}</text>`).join('');
  return `<figure class="chart" style="margin:0"><div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}${band ? '<span><i style="background:var(--band);height:10px"></i>95% CI</span>' : ''}</div>
    <svg viewBox="-${left} -12 ${width + left + 12} ${height + 32}" font-size="${font}" fill="var(--ink-2)" font-family="var(--font)" role="img" aria-label="${esc(label)}">
    ${shade ? `<rect x="${x(shade[0])}" y="0" width="${Math.max(0, x(shade[1]) - x(shade[0]))}" height="${height}" fill="var(--surface-2)"/>` : ''}
    ${ticks.map(t => `<line x1="0" x2="${width}" y1="${y(t)}" y2="${y(t)}" stroke="var(--rule-soft)"/><text x="-8" y="${y(t) + 4}" text-anchor="end">${yFmt(t)}</text>`).join('')}
    ${zero ? `<line x1="0" x2="${width}" y1="${y(0)}" y2="${y(0)}" stroke="var(--ink)" stroke-dasharray="3 3"/>` : ''}
    ${band ? `<path d="${band.map((b, i) => (i ? 'L' : 'M') + x(b.day) + ' ' + y(b.hi)).join('')}${[...band].reverse().map(b => 'L' + x(b.day) + ' ' + y(b.lo)).join('')}Z" fill="var(--band)"/>` : ''}
    ${series.map(s => `<path d="${path(s.points)}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2}" stroke-linejoin="round"/>`).join('')}
    ${markers.filter(m => days.includes(m.day)).map(m => `<line x1="${x(m.day)}" x2="${x(m.day)}" y1="0" y2="${height}" stroke="var(--warn)" stroke-dasharray="4 3"/><text x="${x(m.day) + (small && x(m.day) > width * 0.6 ? -5 : 5)}" y="-1" text-anchor="${small && x(m.day) > width * 0.6 ? 'end' : 'start'}" fill="var(--warn)" font-weight="600">${esc(m.label)}</text>`).join('')}
    ${xl}</svg></figure>`;
}
export const COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
export function rateSeries(daily, metric, smooth) {
  const m = METRICS[metric], out = [];
  for (let i = 0; i < daily.length; i++) {
    const win = smooth ? daily.slice(Math.max(0, i - 6), i + 1) : [daily[i]];
    if (smooth && i < 6) continue;
    const n = win.reduce((a, r) => a + r[m.num], 0), d = win.reduce((a, r) => a + r[m.den], 0);
    out.push([daily[i].day, d ? n / d : null]);
  }
  return out;
}

export function intervalChart(items, mde) {
  const shown = items.filter(i => i.test), vals = shown.flatMap(i => [i.test.ci[0] * 100, i.test.ci[1] * 100]).concat([0, mde, -mde]);
                                                                                 
  const small = narrow(), lo = Math.floor(Math.min(...vals)) - 0.5, hi = Math.ceil(Math.max(...vals)) + 0.5, W = small ? 300 : 420, L = small ? 8 : 230, rowH = small ? 50 : 34, H = items.length * rowH;
  const x = v => L + (v - lo) / (hi - lo) * W, ticks = []; for (let t = Math.ceil(lo); t <= hi; t++) ticks.push(t);
  const col = { pass: 'var(--pass)', fail: 'var(--void)', warn: 'var(--warn)' };
  return `<figure class="chart interval"><svg viewBox="0 -16 ${L + W + 16} ${H + 50}" font-size="${small ? 13 : 12}" font-family="var(--font)" fill="var(--ink)" role="img" aria-label="B minus A with 95% interval, by scenario">
    ${ticks.map(t => `<line x1="${x(t)}" x2="${x(t)}" y1="0" y2="${H}" stroke="var(--rule-soft)"/><text x="${x(t)}" y="${H + 16}" text-anchor="middle" fill="var(--ink-2)">${t > 0 ? '+' : t < 0 ? '−' : ''}${Math.abs(t)}</text>`).join('')}
    <line x1="${x(0)}" x2="${x(0)}" y1="-6" y2="${H}" stroke="var(--ink)"/><line x1="${x(mde)}" x2="${x(mde)}" y1="-6" y2="${H}" stroke="var(--ink-3)" stroke-dasharray="4 3"/>
    <text x="${x(mde) + 4}" y="-4" fill="var(--ink-2)">planned MDE</text><text x="${L + W / 2}" y="${H + 32}" text-anchor="middle" fill="var(--ink-2)">B − A, percentage points</text>
    ${items.map((it, i) => { const y = i * rowH + rowH / 2 + (small ? 8 : 0);
      return `<text x="${small ? 4 : 0}" y="${small ? y - 12 : y + 4}">${esc(it.label)}</text>${it.test ? `<line x1="${x(it.test.ci[0] * 100)}" x2="${x(it.test.ci[1] * 100)}" y1="${y}" y2="${y}" stroke="${col[it.tone]}" stroke-width="3" stroke-linecap="round"/><circle cx="${x(it.test.diff * 100)}" cy="${y}" r="5" fill="${col[it.tone]}"/>`
        : `<text x="${L + 6}" y="${y + 4}" fill="var(--ink-2)" font-style="italic">hidden until the checks pass</text>`}`; }).join('')}</svg></figure>`;
}
