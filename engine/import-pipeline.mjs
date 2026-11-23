                                                                                                        
                                                                                                            
                                                                                                                              
import { parseCsv, findCardNumber, suggestMapping, validateRows, LIMITS } from './csv.mjs';
import { analyse } from './results.mjs';
import { digestMatches, importDigest, auditRows } from '../store/store.mjs';

const fmt = n => Number(n).toLocaleString('en-GB');

                                                                                                                                
export function parseResults(text, experimentId, progress = () => {}) {
  if (text.length > LIMITS.maxBytes) return { fatal: `The file is larger than ${LIMITS.maxBytes / 1024 / 1024} MB.` };
  progress('Reading the rows');
  let table;
  try { table = parseCsv(text); } catch (e) { return { fatal: e.message }; }
  if (table.length < 2) return { fatal: 'The file has no data rows.' };
  if (table.length - 1 > LIMITS.maxRows) return { fatal: `The file has more than ${fmt(LIMITS.maxRows)} rows.` };
  progress(`Checking ${fmt(table.length - 1)} rows for card numbers`);
  if (findCardNumber(table)) return { fatal: 'This file appears to contain card numbers. Remove them and try again. Nothing was stored.' };
  progress(`Validating ${fmt(table.length - 1)} rows`);
  const mapping = suggestMapping(table[0]);
  return { table, mapping, validation: validateRows(table, mapping, experimentId) };
}

                                                                                                        
export const draftSummary = (parsed, mapping = parsed.mapping) => ({
  header: parsed.table[0], rowCount: parsed.table.length - 1, mapping,
  validation: { errors: parsed.validation.errors.slice(0, LIMITS.maxErrorsShown), errorCount: parsed.validation.errors.length, stats: parsed.validation.stats },
});

                                                                                                                               
export async function prepareImport(rows, { plan, coverageThrough, coverageComplete, datasetId, version, evidenceId, guardrails }, progress = () => {}) {
  progress(`Fingerprinting ${fmt(rows.length)} rows`);
  let first = Infinity; for (const r of rows) { const t = Date.parse(r.assigned_at); if (t < first) first = t; }
  const importFingerprint = await importDigest(rows);
  progress('Checking the evidence against the plan');
  const evidence = await auditRows({ plan, rows, coverageThrough, coverageComplete, datasetId, version, evidenceId });
  progress('Analysing the results');
  return { importFingerprint, first, evidence, analysis: analysisOf(rows, evidence, guardrails) };
}

                                                                                                                     
const analysisOf = (rows, evidence, guardrails) => ({ ...analyse(sortedAsStored(rows), evidence, guardrails), explicitUnknown: rows.filter(r => r.outcome_known !== true).length });

                                                                                                                          
export const sortedAsStored = rows => [...rows].sort((a, b) => (a.checkout_id < b.checkout_id ? -1 : a.checkout_id > b.checkout_id ? 1 : a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0));

                                                                                                                                 
                                                                                                                             
export async function checkStored(rows, { evidence, imported, guardrails }) {
  return { check: { digestOk: await digestMatches(rows, imported), rulesVersion: imported.rules_version }, analysis: analysisOf(rows, evidence, guardrails) };
}
