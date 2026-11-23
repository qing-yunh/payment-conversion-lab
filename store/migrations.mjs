                                             
                                                                                                                           
                                                                                                                           
import { rows } from '../engine/analytics.mjs';

export const LATEST = 4;
const OVERRIDE_MARK = 'Overrides the results recommendation';
                                                                                                                     
const READINGS = ['No detectable effect', 'Better on submission, but a guardrail failed', 'B is worse', 'Not enough evidence yet', 'Data problem: no result can be read'];

                                                                                                              
                                                                                                                         
export const DDL_V2 = `CREATE TABLE decision_override (
  decision_id TEXT PRIMARY KEY REFERENCES decision(decision_id),
  results_reading TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('recorded', 'read from the rationale text'))
);
CREATE TRIGGER decision_override_no_update BEFORE UPDATE ON decision_override BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision_override'); END;
CREATE TRIGGER decision_override_no_delete BEFORE DELETE ON decision_override BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: decision_override'); END;`;

                                                                                      
                                                                                                                          
                                  
export const DDL_V3 = ['decision_note', 'result_import', 'opportunity_finding'].map(t =>
  `CREATE TRIGGER ${t}_no_update BEFORE UPDATE ON ${t} BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: ${t}'); END;
CREATE TRIGGER ${t}_no_delete BEFORE DELETE ON ${t} BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: ${t}'); END;`).join('\n');

                                                                                                        
                                  
export const DDL_V4 = `CREATE TABLE result_auth (
  ds INTEGER NOT NULL,
  record_id TEXT NOT NULL,
  auth_ms INTEGER NOT NULL,
  PRIMARY KEY (ds, record_id)
) WITHOUT ROWID;
CREATE TRIGGER result_auth_row_exists BEFORE INSERT ON result_auth WHEN NOT EXISTS (SELECT 1 FROM result_row WHERE ds = NEW.ds AND record_id = NEW.record_id) BEGIN SELECT RAISE(ABORT, 'RESULT_AUTH_WITHOUT_ROW'); END;
CREATE TRIGGER result_auth_no_update BEFORE UPDATE ON result_auth BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_auth'); END;
CREATE TRIGGER result_auth_no_delete BEFORE DELETE ON result_auth BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: result_auth'); END;`;

                                                                                                                         
export const STEPS = [{
  to: 2, adds: ['decision_override', 'decision_override_no_update', 'decision_override_no_delete'],
  run(db) {
    db.exec(DDL_V2);
                                                                                                               
                                                                                                                           
                                                                                                                      
    const head = new RegExp(`^${OVERRIDE_MARK} \\((${READINGS.map(r => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\): `);
    for (const d of rows(db, "SELECT decision_id, rationale FROM decision WHERE verdict = 'Planning Ready' AND rationale LIKE ?", [OVERRIDE_MARK + '%'])) {
      const m = head.exec(d.rationale), parts = m ? d.rationale.slice(m[0].length).split('\n\n') : [];
      if (parts.length === 2 && parts[0].trim()) db.run('INSERT INTO decision_override VALUES (?, ?, ?, ?)', [d.decision_id, m[1], parts[0].trim(), 'read from the rationale text']);
    }
  },
}, {
  to: 3, adds: ['decision_note', 'result_import', 'opportunity_finding'].flatMap(t => [`${t}_no_update`, `${t}_no_delete`]),
  run(db) { db.exec(DDL_V3); },
}, {
  to: 4, adds: ['result_auth', 'result_auth_row_exists', 'result_auth_no_update', 'result_auth_no_delete'],
  run(db) { db.exec(DDL_V4); },
}];

const reference = (SQL, schemaSql, extSql) => { const ref = new SQL.Database(); ref.exec(schemaSql); ref.exec(extSql); return ref; };
                                                                                                                             
                                                                                                               
                                                                                                                              
                                                                                                                              
                  
const QUOTE_END = { "'": "'", '"': '"', '`': '`', '[': ']' };
const layout = s => s.replace(/[ \t\n\f\r]+/g, ' ').replace(/[ \t\n\f\r]*([(),;])[ \t\n\f\r]*/g, '$1');
function norm(text) {
  const s = String(text ?? '');
  let out = '', code = '', i = 0;
  while (i < s.length) {
    const end = QUOTE_END[s[i]];
    if (end) {                                                                             
      let j = i + 1;
      for (;;) { const k = s.indexOf(end, j); if (k < 0) { j = s.length; break; } j = k + 1; if (end === ']' || s[j] !== end) break; j++; }
      out += layout(code) + s.slice(i, j); code = ''; i = j;
    } else if (s.startsWith('--', i)) { const k = s.indexOf('\n', i); code += ' '; i = k < 0 ? s.length : k; }
    else if (s.startsWith('/*', i)) { const k = s.indexOf('*/', i + 2); code += ' '; i = k < 0 ? s.length : k + 2; }
    else code += s[i++];
  }
  return (out + layout(code)).replace(/^ | $/g, '');
}

                                                                                                                      
export function refreshViews(SQL, schemaSql, extSql, candidate) {
  const ref = reference(SQL, schemaSql, extSql), have = new Map(rows(candidate, "SELECT name, sql FROM sqlite_master WHERE type = 'view'").map(v => [v.name, v.sql]));
  for (const v of rows(ref, "SELECT name, sql FROM sqlite_master WHERE type = 'view'")) {
    if (norm(have.get(v.name)) === norm(v.sql)) continue;
    try { candidate.exec(`DROP VIEW IF EXISTS "${v.name}"; ${v.sql};`); } catch (error) { console.error(error); }                                                 
  }
  ref.close();
}
                                                                                                                          
                                                                                                                        
                                                                                           
                                                                                
export function schemaGaps(SQL, schemaSql, extSql, candidate) {
  const ref = reference(SQL, schemaSql, extSql);
  const read = d => rows(d, "SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND sql IS NOT NULL AND type IN ('table', 'index', 'view', 'trigger')");
  const cols = (d, t) => rows(d, 'SELECT name FROM pragma_table_info(?)', [t]).map(c => c.name);
                                                                                                                         
                                                                                                 
  const colFacts = (d, t) => JSON.stringify(rows(d, 'SELECT name, type, "notnull", dflt_value, pk, hidden FROM pragma_table_xinfo(?)', [t])
    .map(c => ({ ...c, type: norm(c.type), dflt_value: c.dflt_value === null ? null : norm(c.dflt_value) })));
  const want = new Map(read(ref).map(o => [o.name, o])), have = new Map(read(candidate).map(o => [o.name, o])), gaps = [];
  for (const o of want.values()) {
    const h = have.get(o.name);
    if (!h) { gaps.push(o.name); continue; }
    if (h.type === o.type && norm(h.sql) === norm(o.sql) && (o.type !== 'table' || colFacts(candidate, o.name) === colFacts(ref, o.name))) continue;
                                                                                                                              
    const missing = o.type === 'table' && h.type === 'table' ? cols(ref, o.name).filter(c => !cols(candidate, o.name).includes(c)) : [];
    gaps.push(...(missing.length ? missing.map(c => `${o.name}.${c}`) : [`${o.name} (changed)`]));
  }
  for (const h of have.values()) if (!want.has(h.name) && h.type !== 'view') gaps.push(`${h.name} (not in this version)`);
  ref.close();
  return gaps;
}

                                                                                                         
export function versionOf(gaps, db) {
  const v = rows(db, 'PRAGMA user_version')[0].user_version;
  if (v >= 1) return v <= LATEST && !gaps.length ? v : v > LATEST ? null : (sameSet(gaps, addedAfter(v)) ? v : null);
  if (!gaps.length) return LATEST;                                                      
  return sameSet(gaps, addedAfter(1)) ? 1 : null;
}
const addedAfter = v => STEPS.filter(s => s.to > v).flatMap(s => s.adds);
const sameSet = (a, b) => a.length === b.length && b.every(x => a.includes(x));

                                                                                                      
function tableFacts(db) {
  const facts = {};
  for (const { name } of rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")) {
    let n = 0, a = 0, b = 0;
    const st = db.prepare(`SELECT * FROM "${name}"`);
    while (st.step()) {
      const s = JSON.stringify(st.get(), (k, v) => (v instanceof Uint8Array ? Array.from(v) : v));
      let h1 = 0x811c9dc5, h2 = 5381;
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 0x01000193); h2 = (Math.imul(h2, 33) + c) | 0; }
      n++; a = (a + (h1 >>> 0)) >>> 0; b = (b + (h2 >>> 0)) >>> 0;
    }
    st.free();
    facts[name] = `${n}:${a}:${b}`;
  }
  return facts;
}

   
                                                                                                                          
                                                                                                                              
                                                                                             
   
export function upgrade(SQL, schemaSql, extSql, bytes, steps = STEPS) {
  const db = new SQL.Database(bytes);
  try {
    refreshViews(SQL, schemaSql, extSql, db);
    const from = versionOf(schemaGaps(SQL, schemaSql, extSql, db), db);
    if (from === null) throw new Error('WORKSPACE_NOT_RECOGNISED');
    if (from === LATEST) return { db, from, to: LATEST, added: {} };
    const before = tableFacts(db);
    db.exec('BEGIN');
    try {
      for (const step of steps.filter(s => s.to > from)) step.run(db);
      db.exec(`PRAGMA user_version = ${LATEST}`);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const after = tableFacts(db), gaps = schemaGaps(SQL, schemaSql, extSql, db), changed = Object.keys(before).filter(t => before[t] !== after[t]);
    const integrity = rows(db, 'PRAGMA integrity_check')[0].integrity_check;
    if (gaps.length || changed.length || integrity !== 'ok')
      throw new Error(`UPGRADE_CHECK_FAILED: ${[...gaps.map(g => 'missing ' + g), ...changed.map(t => 'rows changed in ' + t), integrity === 'ok' ? [] : ['integrity ' + integrity]].join('; ')}`);
    const added = Object.fromEntries(Object.keys(after).filter(t => !(t in before)).map(t => [t, Number(after[t].split(':')[0])]));
    return { db, from, to: LATEST, added };
  } catch (error) { db.close(); throw error; }
}
