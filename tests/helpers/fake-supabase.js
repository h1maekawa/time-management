/**
 * cloud-provider.js のテスト用: 実Supabase Networkに触れない、最小限のFake Query Builder。
 *
 * `.from(table).select(...).eq(...).in(...)` のようなチェーンをawaitすると
 * `{ data, error }` を返す、supabase-jsのthenableなクエリビルダーの挙動をエミュレートする。
 * RLSは無いため、user_idでの絞り込みは呼び出し側コード（cloud-provider.js）が
 * 明示的に `.eq("user_id", ...)` していることに依存する（§9/§40の検証を兼ねる）。
 */

function applyFilters(rows, filters) {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.type === "eq") return row[f.col] === f.value;
      if (f.type === "in") return f.values.includes(row[f.col]);
      if (f.type === "is") return (row[f.col] ?? null) === f.value;
      return true;
    })
  );
}

function makeQueryBuilder(getRows, setRows) {
  const filters = [];
  let mode = null;
  let selectCols = "*";
  let updatePayload = null;
  let upsertRows = null;
  let upsertOpts = null;

  async function execute() {
    const rows = getRows();
    const now = new Date().toISOString();

    if (mode === "update") {
      const matched = applyFilters(rows, filters);
      for (const row of matched) {
        Object.assign(row, updatePayload, { version: (row.version ?? 1) + 1, updated_at: now });
      }
      return { data: matched.map((r) => ({ id: r.id })), error: null };
    }

    if (mode === "upsert") {
      const key = (upsertOpts?.onConflict ?? "id").split(",");
      for (const incoming of upsertRows) {
        const idx = rows.findIndex((r) => key.every((k) => r[k] === incoming[k]));
        if (idx === -1) {
          rows.push({ version: 1, created_at: now, updated_at: now, deleted_at: null, ...incoming });
        } else {
          rows[idx] = { ...rows[idx], ...incoming, version: (rows[idx].version ?? 1) + 1, updated_at: now };
        }
      }
      setRows(rows);
      return { data: null, error: null };
    }

    if (mode === "maybeSingle") {
      const matched = applyFilters(rows, filters);
      return { data: matched[0] ?? null, error: null };
    }

    // select（デフォルト）
    const matched = applyFilters(rows, filters);
    if (selectCols === "*") return { data: matched, error: null };
    const cols = selectCols.split(",").map((c) => c.trim());
    return { data: matched.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]]))), error: null };
  }

  const builder = {
    select(cols) {
      selectCols = cols ?? "*";
      if (mode === null) mode = "select";
      return builder;
    },
    eq(col, value) {
      filters.push({ type: "eq", col, value });
      return builder;
    },
    in(col, values) {
      filters.push({ type: "in", col, values });
      return builder;
    },
    is(col, value) {
      filters.push({ type: "is", col, value });
      return builder;
    },
    update(payload) {
      mode = "update";
      updatePayload = payload;
      return builder;
    },
    upsert(rows, opts) {
      mode = "upsert";
      upsertRows = Array.isArray(rows) ? rows : [rows];
      upsertOpts = opts;
      return execute();
    },
    maybeSingle() {
      mode = "maybeSingle";
      return execute();
    },
    then(resolve, reject) {
      execute().then(resolve, reject);
    },
  };

  return builder;
}

export function createFakeSupabase(initialTables = {}) {
  const db = {};
  for (const [table, rows] of Object.entries(initialTables)) {
    db[table] = rows.map((r) => ({ ...r }));
  }
  return {
    db,
    from(table) {
      if (!db[table]) db[table] = [];
      return makeQueryBuilder(
        () => db[table],
        (rows) => {
          db[table] = rows;
        }
      );
    },
  };
}
