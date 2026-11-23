                                                                                 
                                                                                                            
                                                                                           
function band(rMid, amp, lobes, copies, phase0, steps = 720) {
  let d = '';
  for (let j = 0; j < copies; j++) {
    const phi = phase0 + j * Math.PI / copies;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps * 2 * Math.PI, r = rMid + amp * Math.sin(lobes * t + phi);
      d += (i ? 'L' : 'M') + (r * Math.cos(t)).toFixed(2) + ' ' + (r * Math.sin(t)).toFixed(2);
    }
  }
  return d;
}
export function sealSvg(fingerprint, label, { size = 132, draw = false } = {}) {
  const b = i => parseInt(fingerprint.slice(i * 2, i * 2 + 2), 16);
  const outer = band(45, 6.2, 22 + (b(0) % 9), 7, b(1) / 255 * Math.PI);
  const inner = band(28.5, 5.2, 13 + (b(2) % 6), 6, b(3) / 255 * Math.PI);
  const id = 'ring-' + fingerprint.slice(0, 12) + '-' + label, micro = (fingerprint.toUpperCase() + ' · ').repeat(2);
  return `<svg class="seal${draw ? ' drawing' : ''}" width="${size}" height="${size}" viewBox="-66 -66 132 132" role="img" aria-label="Seal for plan ${label}, fingerprint ${fingerprint.slice(0, 8)}">
    <defs><path id="${id}" d="M0,-60 a60,60 0 1,1 0,120 a60,60 0 1,1 0,-120"/></defs>
    <circle r="63.6" class="rim"/><circle r="56.6" class="rim"/>
    <text class="micro"><textPath href="#${id}" textLength="374" lengthAdjust="spacing">${micro}</textPath></text>
    <path class="g1" d="${outer}"/><circle r="36.8" class="rim thin"/><path class="g2" d="${inner}"/>
    <circle r="17" class="core"/><text class="label" y="-1.5">PLAN</text><text class="label" y="6.5">${label}</text></svg>`;
}
