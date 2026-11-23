                                                                                                        
let worker = null, seq = 0;
const pending = new Map();
                                                                                                                           
                                                                                           
                                                                                                      
export const SILENCE_MS = 60_000;
const silence = () => globalThis.pclTest?.workerSilenceMs ?? SILENCE_MS;
                                                                                                                           
                                                               
function stop(message) {
  const error = Object.assign(new Error(message), { lost: true });
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); }
  pending.clear(); worker?.terminate(); worker = null;
}
const arm = p => { clearTimeout(p.timer); p.timer = setTimeout(() => stop(`The background worker did not respond for ${Math.round(silence() / 1000)} seconds.`), silence()); };
function start() {
  worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    const p = pending.get(data.id); if (!p) return;
    if (data.progress) { arm(p); p.onProgress?.(data.progress); return; }
    clearTimeout(p.timer); pending.delete(data.id);
    if (data.error) p.reject(new Error(data.error)); else p.resolve(data.result);
  };
                                                                     
  worker.onerror = event => { event.preventDefault?.(); stop(event.message || 'The background worker stopped.'); };
}
export function ask(type, body = {}, onProgress) {
  if (!worker) start();
  const id = ++seq;
  return new Promise((resolve, reject) => { const p = { resolve, reject, onProgress }; pending.set(id, p); arm(p); worker.postMessage({ id, type, ...body }); });
}
