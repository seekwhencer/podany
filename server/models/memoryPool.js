// In-memory pool for model unit tests. Implements the subset of the MySQLPool
// interface used by BaseModel (rows/row/firstColumn/run) against plain JS
// arrays so models can be exercised without a live MariaDB connection.

export function makeMemoryPool(initial = {}) {
  const tables = {};
  for (const [name, rows] of Object.entries(initial)) {
    tables[name] = rows.map((r) => ({ ...r }));
  }

  function makePredicate(clause, params) {
    if (!clause) return () => true;
    const parts = clause.split(/\s+AND\s+/i);
    return (row) => parts.every((part, i) => {
      const m = part.match(/^([\w$]+)\s*=\s*\?$/);
      if (!m) throw new Error(`memoryPool: unsupported WHERE fragment "${part}"`);
      return row[m[1]] === params[i];
    });
  }

  function project(selectPart, row) {
    if (!selectPart || selectPart.trim() === '*') return { ...row };
    const cols = selectPart.split(',').map((c) => c.trim().split(/\s+AS\s+/i)[0].trim().split('.').pop());
    const out = {};
    for (const c of cols) out[c] = row[c];
    return out;
  }

  function runSelect(sql, params) {
    const from = sql.match(/\bFROM\s+([\w]+)/i);
    if (!from) throw new Error(`memoryPool: unsupported SELECT "${sql}"`);
    const table = from[1];
    const sel = sql.match(/SELECT\s+(.*?)\s+FROM/is);
    const selectPart = sel ? sel[1] : '*';

    let whereClause = null;
    const whereMatch = sql.match(/\bWHERE\s+(.*?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)/is);
    if (whereMatch) whereClause = whereMatch[1].trim();

    let rows = tables[table].filter(makePredicate(whereClause, params));
    rows = rows.map((r) => project(selectPart, r));

    const order = sql.match(/\bORDER\s+BY\s+([\w]+)\s*(ASC|DESC)?/i);
    if (order) {
      const col = order[1];
      const desc = (order[2] || 'ASC').toUpperCase() === 'DESC';
      rows = rows.slice().sort((a, b) => {
        if (a[col] == null && b[col] == null) return 0;
        if (a[col] == null) return 1;
        if (b[col] == null) return -1;
        return a[col] < b[col] ? -1 : 1;
      });
      if (desc) rows.reverse();
    }
    return rows;
  }

  function parseInsert(sql, params) {
    const m = sql.match(/INSERT\s+INTO\s+([\w]+)\s*\(([^)]*)\)/i);
    if (!m) throw new Error(`memoryPool: unsupported INSERT "${sql}"`);
    const table = m[1];
    const cols = m[2].split(',').map((c) => c.trim().split('.').pop());
    const row = {};
    cols.forEach((c, i) => { row[c] = params[i]; });
    return { table, row, cols };
  }

  function applyUpsertSet(sql, row, params, cols) {
    const setMatch = sql.match(/ON DUPLICATE KEY UPDATE\s+(.+)$/is);
    const setSql = setMatch ? setMatch[1] : '';
    const incoming = {};
    cols.forEach((c, i) => { incoming[c] = params[i]; });
    for (const assignment of setSql.split(',')) {
      const a = assignment.trim();
      if (!a) continue;
      const am = a.match(/^([\w]+)\s*=\s*(.+)$/);
      if (!am) continue;
      const col = am[1];
      const rhs = am[2].trim();
      const vm = rhs.match(/^VALUES\(([\w]+)\)$/i);
      if (vm) row[col] = incoming[vm[1]];
      else if (/^UNIX_TIMESTAMP\(\)$/i.test(rhs)) row[col] = Math.floor(Date.now() / 1000);
      else if (rhs === '?') row[col] = params.shift();
      else row[col] = Number.isNaN(Number(rhs)) ? rhs.replace(/^['"]|['"]$/g, '') : Number(rhs);
    }
  }

  return {
    tables,
    async rows(sql, params = []) { return runSelect(sql, params); },
    async row(sql, params = []) { const r = runSelect(sql, params); return r[0] ?? null; },
    async firstColumn(sql, params = []) {
      const r = runSelect(sql, params);
      if (!r.length) return null;
      return Object.values(r[0])[0] ?? null;
    },
    async run(sql, params = []) {
      const s = sql.trim();
      if (/^INSERT/i.test(s)) {
        const { table, row, cols } = parseInsert(s, params);
        if (!tables[table]) tables[table] = [];
        if (/ON DUPLICATE KEY UPDATE/i.test(s)) {
          const idx = tables[table].findIndex((r) => r.id === row.id);
          if (idx !== -1) {
            applyUpsertSet(s, tables[table][idx], params.slice(), cols);
            return { affectedRows: 1 };
          }
        }
        tables[table].push(row);
        return { affectedRows: 1 };
      }
      if (/^UPDATE/i.test(s)) {
        const m = s.match(/^UPDATE\s+([\w]+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/is);
        if (!m) throw new Error(`memoryPool: unsupported UPDATE "${s}"`);
        const [table, setPart, wherePart] = [m[1], m[2], m[3]];
        if (!tables[table]) tables[table] = [];
        const setPh = (setPart.match(/\?/g) || []).length;
        const setParams = params.slice(0, setPh);
        const evalWhere = makePredicate(wherePart, params.slice(setPh));
        let affected = 0;
        for (const row of tables[table]) {
          if (evalWhere(row)) {
            const parts = setPart.split(',');
            let pi = 0;
            for (const p of parts) {
              const am = p.trim().match(/^([\w]+)\s*=\s*\?$/);
              if (am) row[am[1]] = setParams[pi++];
            }
            affected += 1;
          }
        }
        return { affectedRows: affected };
      }
      if (/^DELETE/i.test(s)) {
        const m = s.match(/^DELETE\s+FROM\s+([\w]+)\s+WHERE\s+(.+)$/i);
        if (!m) throw new Error(`memoryPool: unsupported DELETE "${s}"`);
        const [table, wherePart] = [m[1], m[2]];
        if (!tables[table]) tables[table] = [];
        const before = tables[table].length;
        const evalWhere = makePredicate(wherePart, params);
        tables[table] = tables[table].filter((r) => !evalWhere(r));
        return { affectedRows: before - tables[table].length };
      }
      throw new Error(`memoryPool: unsupported statement "${s}"`);
    }
  };
}

export default makeMemoryPool;
