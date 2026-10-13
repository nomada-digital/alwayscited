import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A stand-in for the supabase-js builder for the DIY P2 tests (13 Oct 2026):
 * limits.ts's room counts, the origins read and the placement-prompt hook.
 * src/lib/tracking/fake-db.mts has no head counts, `contains` or schema, and
 * other packages extend it in this wave, so P2 keeps its own.
 *
 * Two server behaviours it exists for:
 * - **a schema.** With `columns` given for a table, a select, filter or insert
 *   naming a column the table does not have fails as PostgREST does: 42703 for
 *   a select or filter, PGRST204 for an insert. That is the deploy landing
 *   before 20261013010000.
 * - **the live-text index** (20261009040000): a second live prompt with the
 *   same text in one cluster fails with 23505.
 * - **a failed HEAD has no body** (13 Oct 2026 review). A count asked with
 *   `{ head: true }` that fails comes back as postgrest-js gives it over
 *   HTTP: `{ message: "" }`, no code - its error is parsed from a body a HEAD
 *   response does not have (postgrest-js dist/index.mjs, the non-ok branch).
 *   The first version answered 42703 there, which the real client never
 *   does, and so passed a fallback that never fired.
 *
 * `fail` makes the next call on a table fail with a message, once. Every call
 * is logged. Not a `.test.mts`, so the runner does not run it on its own.
 */

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;
export type Call = { table: string; op: "select" | "insert" | "update"; head: boolean; filters: string[] };
type Err = { code?: string; message: string };

export function promptsDb(tables: Tables, opts: { columns?: Record<string, string[]> } = {}) {
  const calls: Call[] = [];
  const fail = new Map<string, Err & { op?: Call["op"] }>();
  let nextId = 1;

  const from = (table: string) => {
    const filters: { text: string; test: (r: Row) => boolean; col: string }[] = [];
    const q = { op: "select" as Call["op"], cols: null as string | null, head: false, count: false, rows: null as Row[] | null, patch: null as Row | null, returning: false, one: null as "one" | "maybe" | null, lim: null as number | null, rng: null as [number, number] | null, order: null as [string, boolean] | null };
    const known = opts.columns?.[table];
    const unknown = (cols: string[]): string | undefined => (known ? cols.find((c) => c !== "*" && !known.includes(c)) : undefined);
    const run = (): { data: unknown; count?: number | null; error: Err | null } => {
      const out = answer();
      return q.head && out.error ? { data: null, count: null, error: { message: "" } } : out;
    };
    const answer = (): { data: unknown; count?: number | null; error: Err | null } => {
      calls.push({ table, op: q.op, head: q.head, filters: filters.map((f) => f.text) });
      const forced = fail.get(table);
      if (forced && (!forced.op || forced.op === q.op)) {
        fail.delete(table);
        return { data: null, error: { message: forced.message, ...(forced.code ? { code: forced.code } : {}) } };
      }
      const rows = (tables[table] ??= []);
      const filterCols = filters.map((f) => f.col);
      if (q.op === "insert") {
        const bad = unknown(q.rows!.flatMap((r) => Object.keys(r)));
        if (bad) return { data: null, error: { code: "PGRST204", message: `Could not find the '${bad}' column of '${table}' in the schema cache` } };
        const made: Row[] = [];
        for (const r of q.rows!) {
          const row: Row = { id: `${table}-${nextId++}`, stopped_on: null, ...r };
          if (table === "tracked_questions" && row.cluster_id && rows.concat(made).some((x) => x.cluster_id === row.cluster_id && x.stopped_on === null && String(x.text).trim().toLowerCase() === String(row.text).trim().toLowerCase())) {
            return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "tracked_questions_cluster_live_text_uniq"' } };
          }
          made.push(row);
        }
        rows.push(...made);
        const out = q.returning ? made.map((r) => pick(r)) : null;
        return { data: q.one ? (out?.[0] ?? null) : out, error: null };
      }
      const bad = unknown([...filterCols, ...(q.cols ? q.cols.split(",").map((c) => c.trim()) : [])]);
      if (bad) return { data: null, error: { code: "42703", message: `column ${table}.${bad} does not exist` } };
      let hit = rows.filter((r) => filters.every((f) => f.test(r)));
      if (q.op === "update") {
        for (const r of hit) Object.assign(r, q.patch);
        return { data: q.returning ? hit.map((r) => pick(r)) : null, error: null };
      }
      if (q.order) {
        const [c, asc] = q.order;
        hit = [...hit].sort((a, z) => (String(a[c]) < String(z[c]) ? -1 : String(a[c]) > String(z[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      const total = hit.length;
      if (q.rng) hit = hit.slice(q.rng[0], q.rng[1] + 1);
      if (q.lim !== null) hit = hit.slice(0, q.lim);
      if (q.head) return { data: null, count: q.count ? total : null, error: null };
      const picked = hit.map((r) => pick(r));
      if (q.one === "maybe") return picked.length > 1 ? { data: null, error: { message: "more than one row" } } : { data: picked[0] ?? null, error: null };
      if (q.one === "one") return picked.length === 1 ? { data: picked[0], error: null } : { data: null, error: { message: "not one row" } };
      return { data: picked, count: q.count ? total : null, error: null };
    };
    const pick = (r: Row): Row => (q.cols && q.cols !== "*" ? Object.fromEntries(q.cols.split(",").map((c) => [c.trim(), r[c.trim()] ?? null])) : { ...r });
    const add = (col: string, text: string, test: (r: Row) => boolean) => (filters.push({ col, text, test }), b);
    const b = {
      select(cols?: string, o?: { count?: string; head?: boolean }) {
        if (q.op === "select") {
          q.cols = cols ?? null;
          q.head = !!o?.head;
          q.count = !!o?.count;
        } else {
          q.returning = true;
          q.cols = cols ?? null;
        }
        return b;
      },
      insert(rows: Row | Row[]) {
        q.op = "insert";
        q.rows = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      update(patch: Row) {
        q.op = "update";
        q.patch = patch;
        return b;
      },
      eq: (c: string, v: unknown) => add(c, `${c}=${String(v)}`, (r) => r[c] === v),
      neq: (c: string, v: unknown) => add(c, `${c}!=${String(v)}`, (r) => r[c] !== v),
      is: (c: string, v: unknown) => add(c, `${c} is ${String(v)}`, (r) => (r[c] ?? null) === v),
      in: (c: string, vs: unknown[]) => add(c, `${c} in`, (r) => vs.includes(r[c])),
      gte: (c: string, v: string) => add(c, `${c}>=${v}`, (r) => String(r[c]) >= v),
      lte: (c: string, v: string) => add(c, `${c}<=${v}`, (r) => String(r[c]) <= v),
      lt: (c: string, v: string) => add(c, `${c}<${v}`, (r) => String(r[c]) < v),
      contains: (c: string, v: unknown) =>
        add(c, `${c} @>`, (r) => {
          const want = typeof v === "string" ? (JSON.parse(v) as Row[]) : (v as Row[]);
          const have = (r[c] ?? []) as Row[];
          return want.every((w) => have.some((h) => Object.entries(w).every(([k, x]) => h[k] === x)));
        }),
      order: (c: string, o: { ascending?: boolean } = {}) => ((q.order = [c, o.ascending !== false]), b),
      limit: (n: number) => ((q.lim = n), b),
      range: (lo: number, hi: number) => ((q.rng = [lo, hi]), b),
      single: () => ((q.one = "one"), b),
      maybeSingle: () => ((q.one = "maybe"), b),
      then(resolve: (v: ReturnType<typeof run>) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(resolve(run()));
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
    };
    return b;
  };
  return {
    db: { from } as unknown as SupabaseClient,
    tables,
    calls,
    /** The next call on `table` (or the next `op` on it) fails with `message` (and `code`). */
    failNext(table: string, message: string, code?: string, op?: Call["op"]) {
      fail.set(table, { message, code, op });
    },
  };
}
