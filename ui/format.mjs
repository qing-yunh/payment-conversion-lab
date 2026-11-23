                                       


export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = (n, dp = 0) => Number(n).toLocaleString('en-GB', { maximumFractionDigits: dp, minimumFractionDigits: dp });
                                                                                                                           
                                                                                                                                    
                                                                                                                                         
const HELD = /^Submission fell while issuer approval in the same segment held \((.+?) → (.+?)\): the loss happens before shoppers press Pay\.$/;
export function observedWhy(why) {
  const m = HELD.exec(why ?? '');
  if (!m) return why;
  const seen = m[1] === 'n/a' || m[2] === 'n/a' ? 'Issuer approval in the same segment could not be compared.' : `Issuer approval in the same segment was ${m[1]} before and ${m[2]} after.`;
  return `Submission fell. ${seen} This suggests looking first at the steps before shoppers press Pay; the cause is not yet confirmed.`;
}
export const pct = (n, d, dp = 1) => (d ? (n / d * 100).toFixed(dp) + '%' : '—');
export const rate = (x, dp = 1) => (x === null || x === undefined || Number.isNaN(x) ? '—' : (x * 100).toFixed(dp) + '%');
export const pp = (x, dp = 2) => (x === null || x === undefined ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(dp) + ' pp');
export const gbp = minor => '£' + num(minor / 100, 0);
export const pval = p => (p === undefined || p === null ? '—' : p < 0.001 ? '< 0.001' : p.toFixed(3));
export const dayLabel = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

                  
export const ICON = { check: '<polyline points="20 6 9 17 4 12"/>', x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  q: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5"/><line x1="12" y1="17" x2="12" y2="17.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>', chev: '<polyline points="9 6 15 12 9 18"/>',
  alert: '<path d="M12 3 2 20h20L12 3z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17.01"/>',
  back: '<polyline points="15 6 9 12 15 18"/>', down: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="6 13 12 19 18 13"/>',
  upload: '<path d="M12 16V4"/><polyline points="7 9 12 4 17 9"/><path d="M4 20h16"/>', download: '<path d="M12 4v12"/><polyline points="7 11 12 16 17 11"/><path d="M4 20h16"/>' };
export const icon = n => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
                                                                                                                 
                                                                                                  
export const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 640px)').matches;
export const fold = (title, html) => (narrow() ? `<details class="m-fold"><summary>${title}</summary><div class="stack">${html}</div></details>` : html);
export const pill = (kind, text) => `<span class="pill ${kind}">${icon({ pass: 'check', fail: 'x', unknown: 'q', warn: 'clock' }[kind])}${esc(text)}</span>`;
