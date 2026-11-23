                                                                                                     
                                                                                                              
import { parseResults, draftSummary, prepareImport, checkStored } from '../engine/import-pipeline.mjs';
import { validateRows } from '../engine/csv.mjs';

const files = new Map(), gathered = new Map();
self.onmessage = async ({ data: m }) => {
  const reply = body => self.postMessage({ id: m.id, ...body }), progress = stage => self.postMessage({ id: m.id, progress: stage });
  try {
    if (m.type === 'parse') {
      progress('Reading the file');
      const parsed = parseResults(m.file ? await m.file.text() : m.text, m.experimentId, progress);
      if (parsed.fatal) return reply({ result: { fatal: parsed.fatal } });
      files.set(m.job, parsed); return reply({ result: draftSummary(parsed) });
    }
    const file = files.get(m.job);
    if (m.type === 'remap') { file.mapping = m.mapping; file.validation = validateRows(file.table, m.mapping, m.experimentId); return reply({ result: draftSummary(file) }); }
    if (m.type === 'prepare') return reply({ result: { ...await prepareImport(file.validation.rows, m.options, progress), count: file.validation.rows.length } });
    if (m.type === 'rows') return reply({ result: file.validation.rows.slice(m.from, m.from + m.size) });
    if (m.type === 'drop') { files.delete(m.job); return reply({ result: true }); }
                                                                                                        
    if (m.type === 'feed') { const list = gathered.get(m.key) ?? []; for (const r of m.rows) list.push(r); gathered.set(m.key, list); return reply({ result: list.length }); }
    if (m.type === 'forget') { gathered.delete(m.key); return reply({ result: true }); }                                           
    if (m.type === 'check') { const list = gathered.get(m.key) ?? []; gathered.delete(m.key); progress('Analysing'); return reply({ result: await checkStored(list, m.options) }); }
    reply({ error: `Unknown request ${m.type}` });
  } catch (error) { reply({ error: error.message }); }
};
