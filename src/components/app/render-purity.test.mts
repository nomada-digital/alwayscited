/**
 * RENDER PURITY (13 Oct 2026, dashboard speed work). Rendering a dashboard
 * page reads; it never writes, spends, mails or queues. That was true on this
 * date by reading (the speed investigation's census of the page graph), and
 * nothing held it. It matters more from today: the sidebar's links are
 * prefetch={true} (fresh.ts), and a Full prefetch is an ordinary render to the
 * server - Next sends no next-router-prefetch header with it
 * (segment-cache/cache.js 1947-1957) and proxy.ts never sees flight headers -
 * so any write a render ever makes would fire, unseen, for every sidebar link
 * in view on every page view.
 *
 * What is walked: the static import graph from every page and special file
 * under src/app/app/[client], src/app/app/layout.tsx and src/app/app/page.tsx,
 * and the root layout, not-found and error above them (review, 13 Oct 2026),
 * resolving `@/` and relative specifiers (.ts, .tsx, .mts), following
 * `export ... from` and `import("...")`, skipping `import type`.
 *
 * What counts as a write site:
 *  - `.insert( .update( .upsert( .delete(` on a Supabase query builder - a
 *    call chain with a `.from(` in it - and `.rpc(` on anything;
 *  - `after(` imported from next/server;
 *  - `fetch(`, `runOnDemand(`, `enqueue...(`, `send...(` and `mail...(`;
 *  - a filesystem write (writeFile, appendFile, mkdir, rm, unlink, rename).
 * The four method names on anything that is neither a `.from(` chain nor a
 * crypto digest are listed in UNCHAINED, each said to be a write or not, so a
 * query builder held in a variable cannot pass as "not a chain".
 *
 * Then taint, for server modules: a top-level declaration is a writer when it
 * holds a site, or names a local writer or an imported one (to a fixpoint over
 * the graph). By reference, not by call - a writer named in a branch a GET
 * never takes still taints - so it errs loud. A client module ("use client")
 * stops the taint: its code does not run in the render a prefetch asks for,
 * and its sites are in CLIENT_SITES with where they run.
 *
 * The facts:
 *  1. No export of a page or layout is a writer. This is the rule itself.
 *  2. WRITERS: every server module in the graph with a writer in it, and every
 *     name the graph imports from it - each pure helper or read with what it
 *     is, and each writer handed on to another listed module with exactly who
 *     takes it. A new writer module entering the graph, or a new name taken
 *     from a listed one, fails here until someone writes down why it is safe.
 *  3. Nothing in the graph writes at import time (module-level code).
 *  4. The packages the graph imports, so a vendor client (Anthropic, Resend,
 *     Stripe, DataForSEO) arriving in a page's graph fails here.
 *  5. No server action ("use server") in the graph. When one comes, read
 *     fresh.ts first: it must revalidatePath(..., "layout") or updateTag, and
 *     never next/cache refresh() alone, which leaves the sidebar's prefetched
 *     pages standing (server-action-reducer.js 218-238).
 *
 * The honest limit: a static census, not a runtime trace. A write reached
 * through a value handed in at runtime is seen only where the value is built
 * (prompt-step.ts's PromptPort: dbPromptPort is a writer, and runPromptStep
 * calls whatever port it is given). A name built at runtime, or a write inside
 * a package, is not seen.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { test } from "node:test";

import ts from "typescript";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const APP = join(ROOT, "src", "app", "app");
const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

/**
 * The four builder method names called on something that is not a `.from(`
 * chain, keyed "<file> <callee>(" - a write or not, and why.
 */
const UNCHAINED: Record<string, { write: boolean; why: string }> = {
  "src/lib/diy/opportunities/prompt-step.ts port.insert(": {
    write: true,
    why: "PromptPort.insert, in runPromptStep and swapPromptStep: a tracked_questions insert when the port is dbPromptPort's. Both run from POST /opportunity and /prompt-offer only; the page imports offeredPrompt and noClusterReason, which name neither.",
  },
  "src/components/app/DatePicker.tsx q.delete(": {
    write: false,
    why: "URLSearchParams.delete on the browser's own query string, building the range URL DatePicker pushes. No table.",
  },
};

/** Client modules in the graph with a site in them, and where it runs. */
const CLIENT_SITES: Record<string, string> = {
  "src/components/app/UsageBeacon.tsx":
    "fetch POST to /api/app/[client]/event from a useEffect and a click listener: in the browser, after the page mounts. A prefetch renders the RSC payload only and mounts nothing, so it sends no view (BRIEF-2 T10).",
};

/**
 * The packages the graph imports, 13 Oct 2026. None puts a request on the
 * wire but Supabase, and that one through the reads below.
 */
const PACKAGES: Record<string, string> = {
  react: "components and hooks",
  "next/navigation": "notFound, redirect and the client hooks",
  "next/link": "Link, inside AppLink",
  "next/headers": "cookies().get for the session (member.ts); nothing sets a cookie",
  "server-only": "the marker that keeps a server module out of the client bundle",
  "@supabase/supabase-js": "the client type and createClient (supabase/admin.ts); every call on it is held by this file",
  zod: "parsing",
  "node:crypto": "createHash and createHmac digests and randomBytes: no I/O",
  "node:fs": "readFileSync and existsSync of committed JSON (the fixture, origins); fs writes are a site here",
  "node:path": "join",
  "next/font/google": "the root layout's face, resolved and self-hosted at build: no request at render (review, 13 Oct 2026)",
};

/**
 * Every server module in the graph that holds a writer, as of 13 Oct 2026.
 * `writes` is what the module's writers do and where they are called from;
 * `pure` is each name the graph imports from it; `passes` is each writer
 * name the graph imports from it, with every module that takes it. A module
 * that takes a writer is itself listed here, so its own names are read too.
 */
const WRITERS: Record<string, { writes: string; pure: Record<string, string>; passes?: Record<string, { by: string[]; why: string }> }> = {
  "src/lib/tracking/ask.ts": {
    writes: "recordAsk and recordHidden insert cta_events, from POST /ask and /hide.",
    pure: {
      ASK_ITEMS_MAX: "a constant",
      ASK_REFUSED: "fixed words",
      askRefusal: "a code from the URL to its words",
      askToast: "the toast's words",
      upsellMode: "a client_domains value to its mode",
    },
  },
  "src/lib/tracking/limits.ts": {
    writes: "insertPrompts, insertKeyword, insertCluster, groupPrompts, moveIntoCluster, linkKeyword and cancelTrial write tracked_questions, tracked_keywords, clusters, client_domains and dashboard_events, from POST /prompt, /cluster, /group, /keyword and /trial and the admin.",
    pure: {
      ANGLES: "a constant",
      BRANDED_CHIP: "fixed words",
      BRANDED_NOTE: "fixed words",
      CLUSTER_BASE: "a constant",
      KEYWORDS_PER_CLUSTER: "a constant",
      PLACEMENT_FULL: "fixed words",
      PLACEMENT_PROMPTS_PER_CLIENT: "a constant",
      PROMPTS_PER_CLUSTER: "a constant",
      angleFor: "a scan kind to its angle",
      freeAngle: "the first angle not held",
      livePromptCount: "a head count of live prompts",
      missingColumn: "reads a PostgREST error",
      namesBrandIn: "a text test",
      promptRoom: "arithmetic",
      readClusterRefusal: "a read of live clusters",
      readPromptRoom: "a read of live prompts",
      readingsFor: "a head count of readings",
      refuseCluster: "a rule",
      refuseEdit: "a rule",
      refuseGrouping: "a rule",
      refuseKeyword: "a rule",
      refusePrompts: "a rule",
    },
    passes: {
      insertKeyword: { by: ["src/lib/tracking/rekey.ts"], why: "changeKeyword, from POST /keyword" },
      insertPrompts: {
        by: ["src/lib/diy/opportunities/prompt-step.ts", "src/lib/diy/prompts/placement-prompt.ts", "src/lib/tracking/slot.ts"],
        why: "dbPromptPort (POST /opportunity, /prompt-offer), addPlacementPrompt (admin), fillSlot and fillSlots (POST /prompt, the add-cluster flow)",
      },
    },
  },
  "src/lib/tracking/note.ts": {
    writes: "addNote inserts tracking_notes, from POST /note.",
    pure: { NOTE_SAID: "fixed words", noteState: "a code from the URL" },
  },
  "src/lib/tracking/slot.ts": {
    writes: "fillSlot and fillSlots, through limits.ts insertPrompts, from POST /prompt and the add-cluster flow.",
    pure: {
      PROMPT_MIN: "a constant (prompt-text.ts)",
      SLOT_WHY: "fixed words",
      fullLine: "words from two counts",
      refuseSlotText: "a rule (prompt-text.ts)",
      slotRefusal: "a code from the URL to its words",
    },
  },
  "src/lib/tracking/stop.ts": {
    writes: "stop and undoStop update tracked_questions, tracked_keywords and clusters, from POST /stop.",
    pure: {
      BULK_ID: "a constant",
      BULK_MAX: "a constant",
      refuseRole: "a rule",
      refuseStop: "a rule",
      refuseUndo: "a rule",
      stopDay: "date arithmetic",
    },
    passes: {
      stop: { by: ["src/lib/diy/opportunities/prompt-step.ts"], why: "dbPromptPort's stop, from POST /opportunity and /prompt-offer" },
      undoStop: { by: ["src/lib/diy/opportunities/prompt-step.ts"], why: "dbPromptPort's undoStop, from POST /prompt-offer" },
    },
  },
  "src/lib/diy/keywords/write.ts": {
    writes: "writeDismissal and lapseDismissal write diy_dismissals, from POST /keywords.",
    pure: { keywordsToast: "the toast's words", readDone: "a code from the URL", readOnlyReason: "fixed words", readWhy: "a code from the URL" },
  },
  "src/lib/diy/opportunities/prompt-step.ts": {
    writes: "dbPromptPort inserts and stops prompts; runPromptStep and swapPromptStep call a port's insert (UNCHAINED). From POST /opportunity and /prompt-offer.",
    pure: { noClusterReason: "fixed words", offeredPrompt: "the offered prompt, marked Pure in its own comment" },
  },
  "src/lib/diy/opportunities/status.ts": {
    writes: "applyDecision, ensureOpportunity, pursueOpportunity and syncPlanItem write opportunities and plan_items, from POST /opportunity and /links.",
    pure: {
      ENDED_REASON: "fixed words",
      VIEWER_REASON: "fixed words",
      countActive: "a head count of pursued pages",
      historyOf: "a stored history read back",
      oppToast: "the toast's words",
      opportunityOf: "a row to an Opportunity",
      pursuitCap: "a number from the allowances",
    },
  },
  "src/lib/diy/pages/key-pages.ts": {
    writes: "insertKeyPage, removeKeyPage and setKeyPageClusters write key_pages, from POST /pages.",
    pure: { CITED_DAYS: "a constant", KEY_PAGE_COLUMNS: "a select list", KEY_PAGE_URL_MAX: "a constant", isOwnUrl: "a URL test", keyPageOf: "a row to a KeyPage" },
  },
  "src/lib/diy/prompts/placement-prompt.ts": {
    writes: "addPlacementPrompt, makeRoom, stopPlacementPrompt, undoRotation and placementSaved, from the admin's placement actions only.",
    pure: { loadPlacementPromptsOn: "a read of app_settings" },
  },
  "src/lib/tracking/team.ts": {
    writes: "invite, changeRole, removeMember, keepRow and writeMember write dashboard_members and the scopes, from POST /member.",
    pure: {
      inviteChoice: "the form's choice from counts",
      inviteRefusal: "a code to its words",
      planTeam: "the team change worked out, written by the route",
      refuseActor: "a rule",
      removeKind: "a row's kind",
      removeLine: "fixed words",
      scopeLine: "fixed words",
      teamToast: "the toast's words",
    },
  },
  "src/lib/diy/opportunities/refresh.job.ts": {
    writes: "applyRefresh and opportunityRefreshHandler, the night job.",
    pure: { ENGINE_ORDER: "a constant" },
  },
  "src/lib/tracking/scope.ts": {
    writes: "addScope, dropScope and clearScope write dashboard_member_clients, through team.ts from POST /member.",
    // 13 Oct 2026 (merge with the dashboard speed work's render package): the membership read no longer calls
    // readScopes - it embeds the live scope rows in its one members read (shell.ts readShell), as Settings'
    // members read does (settings-data.ts), and both group them with scopesFrom.
    pure: {
      readScopes: "a read of dashboard_member_clients; team.ts's readTeam and removeMember take it",
      scopesFrom: "groups live scope rows by member; no I/O (shell.ts, settings-data.ts)",
      sees: "a test",
      visibleClients: "a filter",
    },
    passes: {
      addScope: { by: ["src/lib/tracking/team.ts"], why: "invite and changeRole, from POST /member" },
      clearScope: { by: ["src/lib/tracking/team.ts"], why: "invite and changeRole, from POST /member" },
      dropScope: { by: ["src/lib/tracking/team.ts"], why: "removeMember, from POST /member" },
    },
  },
  "src/lib/tracking/rekey.ts": {
    writes: "changeKeyword updates tracked_keywords and clusters, from POST /keyword.",
    pure: { KEYWORD_FIXED_NOTE: "fixed words", refuseRekey: "a rule" },
  },
  "src/lib/diy/plan/write.ts": {
    writes: "insertTask, updatePlanItem, upsertPlanItemFor, markVerified and applyRefresh write plan_items, from POST /plan, /opportunity and the night job.",
    pure: { getPlanItem: "a read of one plan item" },
    passes: {
      updatePlanItem: { by: ["src/lib/diy/opportunities/status.ts"], why: "syncPlanItem, from POST /opportunity" },
      upsertPlanItemFor: { by: ["src/lib/diy/opportunities/status.ts"], why: "syncPlanItem, from POST /opportunity" },
    },
  },
  "src/lib/tracking/admin-edit.ts": {
    writes: "adminEdit and adminStop, from the admin's server actions.",
    pure: {},
    passes: { adminStop: { by: ["src/lib/diy/prompts/placement-prompt.ts"], why: "stopPlacementPrompt and makeRoom, admin only" } },
  },
  "src/lib/tracking/edit.ts": {
    writes: "editPrompts updates tracked_questions, from POST /edit.",
    pure: { refuseEdits: "a rule" },
  },
};

type Site = { kind: string; line: number; text: string; decl: string | null };
type Ref = { local: string } | { from: string | null; name: string };
type Mod = {
  file: string;
  client: boolean;
  server: boolean;
  /** Value imports: local binding to where it comes from. `from` null is a package. */
  imports: Map<string, { from: string | null; name: string }>;
  /** Every value import or re-export, with the names it takes ("*" for all, [] for a bare import). */
  edges: { from: string | null; spec: string; names: string[] }[];
  decls: Map<string, ts.Node>;
  exports: Map<string, Ref>;
  stars: (string | null)[];
  sites: Map<string, Site[]>;
  /** Sites that run when the module is first imported. */
  moduleSites: Site[];
  /** The builder method names on something that is not a .from( chain: UNCHAINED's keys. */
  unchained: Site[];
  /** Per declaration: the identifiers and dynamic imports it names. */
  refs: Map<string, { names: Set<string>; dyn: (string | null)[] }>;
};

const DB_WRITES = new Set(["insert", "update", "upsert", "delete"]);
const FS_WRITES = /^(writeFile|appendFile|mkdir|mkdtemp|rm|rmdir|unlink|rename|copyFile|cp|truncate)(Sync)?$/;

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  if (/\.(ts|tsx|mts)$/.test(base) && existsSync(base)) return base;
  for (const e of [".ts", ".tsx", ".mts"]) if (existsSync(base + e)) return base + e;
  for (const e of [".ts", ".tsx", ".mts"]) if (existsSync(join(base, "index" + e))) return join(base, "index" + e);
  if (existsSync(base) && statSync(base).isFile()) return base; // JSON or CSS: no code
  throw new Error(`${rel(from)}: cannot resolve "${spec}" - the walk would stop here and read clean`);
}

const isFunctionLike = (n: ts.Node) => ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isConstructorDeclaration(n);

/** A Supabase query builder: a `.from(` call somewhere down the receiver chain. */
function fromChain(e: ts.Expression): boolean {
  let n: ts.Node = e;
  for (;;) {
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "from") return true;
      n = n.expression;
    } else if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n) || ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isAwaitExpression(n)) n = n.expression;
    else return false;
  }
}

/** `createHash(...).update(` and `createHmac(...).update(`: a digest, not a row. */
const isDigest = (e: ts.Expression) => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && /^create(Hash|Hmac)$/.test(e.expression.text);

function parse(file: string, text: string, resolver: (from: string, spec: string) => string | null = resolve): Mod {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const directives: string[] = [];
  for (const st of sf.statements) {
    if (ts.isExpressionStatement(st) && ts.isStringLiteral(st.expression)) directives.push(st.expression.text);
    else break;
  }
  const m: Mod = { file, client: directives.includes("use client"), server: directives.includes("use server"), imports: new Map(), edges: [], decls: new Map(), exports: new Map(), stars: [], sites: new Map(), moduleSites: [], unchained: [], refs: new Map() };
  const afterNames = new Set<string>();
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const mods = (n: ts.Node) => (ts.canHaveModifiers(n) ? (ts.getModifiers(n) ?? []) : []);
  const exported = (n: ts.Node) => mods(n).some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (n: ts.Node) => mods(n).some((x) => x.kind === ts.SyntaxKind.DefaultKeyword);

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st)) {
      const spec = (st.moduleSpecifier as ts.StringLiteral).text;
      const c = st.importClause;
      if (c?.isTypeOnly) continue;
      const from = resolver(file, spec);
      const names: string[] = [];
      if (c?.name) {
        m.imports.set(c.name.text, { from, name: "default" });
        names.push("default");
      }
      const nb = c?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) {
        m.imports.set(nb.name.text, { from, name: "*" });
        names.push("*");
      } else if (nb) {
        for (const el of nb.elements) {
          if (el.isTypeOnly) continue;
          const name = (el.propertyName ?? el.name).text;
          m.imports.set(el.name.text, { from, name });
          names.push(name);
          if (spec === "next/server" && name === "after") afterNames.add(el.name.text);
        }
      }
      if (c && !names.length) continue; // every binding a type
      m.edges.push({ from, spec, names });
    } else if (ts.isExportDeclaration(st)) {
      if (st.isTypeOnly) continue;
      if (st.moduleSpecifier) {
        const spec = (st.moduleSpecifier as ts.StringLiteral).text;
        const from = resolver(file, spec);
        const names: string[] = [];
        if (!st.exportClause) {
          m.stars.push(from);
          names.push("*");
        } else if (ts.isNamespaceExport(st.exportClause)) {
          m.exports.set(st.exportClause.name.text, { from, name: "*" });
          names.push("*");
        } else {
          for (const el of st.exportClause.elements) {
            if (el.isTypeOnly) continue;
            const name = (el.propertyName ?? el.name).text;
            m.exports.set(el.name.text, { from, name });
            names.push(name);
          }
        }
        if (names.length) m.edges.push({ from, spec, names });
      } else if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) if (!el.isTypeOnly) m.exports.set(el.name.text, { local: (el.propertyName ?? el.name).text });
      }
    } else if (ts.isExportAssignment(st)) {
      if (ts.isIdentifier(st.expression)) m.exports.set("default", { local: st.expression.text });
      else {
        m.decls.set("default", st.expression);
        m.exports.set("default", { local: "default" });
      }
    } else if (ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) {
      const name = st.name?.text ?? "default";
      m.decls.set(name, st);
      if (exported(st)) m.exports.set(isDefault(st) ? "default" : name, { local: name });
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        const bind = (b: ts.BindingName) => {
          if (ts.isIdentifier(b)) {
            m.decls.set(b.text, d);
            if (exported(st)) m.exports.set(b.text, { local: b.text });
          } else for (const el of b.elements) if (!ts.isOmittedExpression(el)) bind(el.name);
        };
        bind(d.name);
      }
    }
  }

  const siteOf = (n: ts.Node, decl: string | null): Site | null => {
    if (!ts.isCallExpression(n)) return null;
    const e = n.expression;
    const name = ts.isPropertyAccessExpression(e) ? e.name.text : ts.isIdentifier(e) ? e.text : null;
    if (!name) return null;
    const at = { line: line(n), text: e.getText(sf).replace(/\s+/g, " ").slice(-80) + "(", decl };
    if (ts.isPropertyAccessExpression(e) && name === "rpc") return { kind: "rpc", ...at };
    if (ts.isPropertyAccessExpression(e) && DB_WRITES.has(name)) {
      if (fromChain(e.expression)) return { kind: "db", ...at };
      if (!isDigest(e.expression)) return { kind: "unchained", ...at };
      return null;
    }
    if (ts.isIdentifier(e) && afterNames.has(name)) return { kind: "after", ...at };
    if (name === "fetch") return { kind: "fetch", ...at };
    if (name === "runOnDemand" || /^enqueue/i.test(name)) return { kind: "queue", ...at };
    if (/^(send|mail)[A-Z]/.test(name)) return { kind: "mail", ...at };
    if (FS_WRITES.test(name)) return { kind: "fs", ...at };
    return null;
  };

  const scan = (root: ts.Node, decl: string | null, out: Site[], refs?: { names: Set<string>; dyn: (string | null)[] }) => {
    const visit = (n: ts.Node) => {
      if (ts.isTypeNode(n)) return;
      if (decl === null && n !== root && isFunctionLike(n)) return; // module level: only what runs on import
      const s = siteOf(n, decl);
      if (s) out.push(s);
      if (refs && ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const arg = n.arguments[0];
        if (arg && ts.isStringLiteral(arg)) {
          const from = resolver(file, arg.text);
          refs.dyn.push(from);
          m.edges.push({ from, spec: arg.text, names: ["*"] });
        }
      }
      if (refs && ts.isIdentifier(n)) {
        const p = n.parent;
        const isName =
          (ts.isPropertyAccessExpression(p) && p.name === n) ||
          (ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isJsxAttribute(p) && p.name === n) ||
          ((ts.isMethodDeclaration(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p)) && p.name === n);
        if (!isName) refs.names.add(n.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(root);
  };

  for (const [name, node] of m.decls) {
    if (m.refs.has(name)) continue; // one declaration binding several names was read once
    const sites: Site[] = [];
    const refs = { names: new Set<string>(), dyn: [] as (string | null)[] };
    scan(node, name, sites, refs);
    for (const [other, n] of m.decls) if (n === node) m.refs.set(other, refs);
    m.unchained.push(...sites.filter((s) => s.kind === "unchained"));
    const real = sites.filter((s) => s.kind !== "unchained");
    if (real.length) m.sites.set(name, real);
  }
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) continue;
    const at: Site[] = [];
    scan(st, null, at);
    m.moduleSites.push(...at.filter((s) => s.kind !== "unchained"));
    for (const s of at.filter((x) => x.kind === "unchained")) if (!m.unchained.some((u) => u.line === s.line && u.text === s.text)) m.unchained.push(s);
  }
  return m;
}

/** UNCHAINED entries said to be writes become sites of the declaration they are in. */
function applyUnchained(m: Mod) {
  for (const u of m.unchained) {
    if (!UNCHAINED[`${rel(m.file)} ${u.text}`]?.write) continue;
    if (u.decl === null) m.moduleSites.push(u);
    else m.sites.set(u.decl, [...(m.sites.get(u.decl) ?? []), u]);
  }
}

/** Writers by fixpoint: the declarations of server modules that hold a site or name a writer. */
function taint(mods: Map<string, Mod>) {
  const tainted = new Map<string, Set<string>>();
  for (const m of mods.values()) tainted.set(m.file, new Set(m.client ? [] : m.sites.keys()));
  const exportTainted = (file: string | null, name: string, seen = new Set<string>()): boolean => {
    const m = file === null ? undefined : mods.get(file);
    if (!m || m.client) return false;
    const key = `${m.file}#${name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    if (name === "*") return [...m.exports.keys()].some((n) => exportTainted(m.file, n, seen)) || m.stars.some((s) => exportTainted(s, "*", seen));
    const e = m.exports.get(name);
    if (e) return "local" in e ? tainted.get(m.file)!.has(e.local) : exportTainted(e.from, e.name, seen);
    return m.stars.some((s) => exportTainted(s, name, seen));
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of mods.values()) {
      if (m.client) continue;
      const mine = tainted.get(m.file)!;
      for (const [decl, refs] of m.refs) {
        if (mine.has(decl)) continue;
        const hit =
          [...refs.names].some((n) => (n !== decl && mine.has(n)) || (m.imports.has(n) && exportTainted(m.imports.get(n)!.from, m.imports.get(n)!.name))) ||
          refs.dyn.some((f) => exportTainted(f, "*"));
        if (hit) {
          mine.add(decl);
          changed = true;
        }
      }
    }
  }
  /** Is `name` a value this module exports, directly, re-exported or through a star? A type imported without `type` is not. */
  const exportsValue = (file: string | null, name: string, seen = new Set<string>()): boolean => {
    const m = file === null ? undefined : mods.get(file);
    if (!m || seen.has(m.file)) return false;
    seen.add(m.file);
    return name === "*" || m.exports.has(name) || m.stars.some((s) => exportsValue(s, name, seen));
  };
  return { tainted, exportTainted, exportsValue };
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

const ROOTS = [
  ...walkFiles(join(APP, "[client]")).filter((f) => /[\\/](page|layout|template|not-found|error|default)\.tsx$/.test(f)),
  join(APP, "layout.tsx"),
  join(APP, "page.tsx"),
  // Review, 13 Oct 2026: the root layout renders on every dashboard document, and the root not-found and error
  // stand in for a dashboard page when one throws past [client]'s own. A write under them was not seen.
  join(ROOT, "src", "app", "layout.tsx"),
  join(ROOT, "src", "app", "not-found.tsx"),
  join(ROOT, "src", "app", "error.tsx"),
].sort();

function walkGraph() {
  const mods = new Map<string, Mod>();
  const queue = [...ROOTS];
  while (queue.length) {
    const f = queue.shift()!;
    if (mods.has(f) || !/\.(ts|tsx|mts)$/.test(f)) continue;
    const m = parse(f, readFileSync(f, "utf8"));
    applyUnchained(m);
    mods.set(f, m);
    for (const e of m.edges) if (e.from && !mods.has(e.from)) queue.push(e.from);
  }
  return mods;
}

const MODS = walkGraph();
const { tainted: TAINTED, exportTainted, exportsValue } = taint(MODS);

/** What the graph imports from each server module that holds a writer: the clean names, and each writer name with who takes it. */
function observedWriters() {
  const out: Record<string, { pure: string[]; passes: Record<string, string[]> }> = {};
  for (const m of MODS.values()) {
    if (m.client || !TAINTED.get(m.file)!.size) continue;
    const pure = new Set<string>();
    const passes: Record<string, Set<string>> = {};
    for (const importer of MODS.values()) {
      for (const e of importer.edges) {
        if (e.from !== m.file) continue;
        for (const n of e.names) {
          if (!exportsValue(m.file, n)) continue;
          if (exportTainted(m.file, n)) (passes[n] ??= new Set()).add(rel(importer.file));
          else pure.add(n);
        }
      }
    }
    out[rel(m.file)] = { pure: [...pure].sort(), passes: Object.fromEntries(Object.entries(passes).map(([n, by]) => [n, [...by].sort()])) };
  }
  return out;
}

/**
 * Floors, 13 Oct 2026: 22 roots - the 18 pages, [client]'s error and
 * not-found, the /app layout and the /app index - and 283 modules (.ts, .tsx,
 * .mts) walked from them. The investigation counted 282 files by its own
 * walk; FreshGuard and fresh.ts joined the graph the same day.
 *
 * Moved by the review the same day: 25 roots, with the root layout,
 * not-found and error, and 296 modules - those three and 9 they reach (the
 * site's header, footer, chrome and nav dropdown, the deployment guard and
 * motion scripts, the schema graph), and NavLink.tsx. Every rule held on the
 * wider walk; the one new fact was next/font/google in PACKAGES.
 */
const ROOT_FLOOR = 25;
const MODULE_FLOOR = 296;

test("census floor: the walk still reaches the dashboard's graph", () => {
  assert.ok(ROOTS.length >= ROOT_FLOOR, `${ROOTS.length} roots, floor ${ROOT_FLOOR}`);
  assert.ok(MODS.size >= MODULE_FLOOR, `${MODS.size} modules walked, floor ${MODULE_FLOOR}`);
  assert.ok(Object.keys(WRITERS).length && [...MODS.values()].some((m) => m.sites.size), "the site matchers find nothing: a walk that stops matching reads clean");
});

test("the rule: no export of a page or layout is a writer", () => {
  const bad = ROOTS.flatMap((r) => [...MODS.get(r)!.exports.keys()].filter((n) => exportTainted(r, n)).map((n) => `${rel(r)} # ${n}`));
  assert.deepEqual(bad, [], "a dashboard render can reach a write, and every sidebar prefetch would fire it");
});

test("WRITERS: every server module holding a writer, and every name the graph takes from it", () => {
  const seen = observedWriters();
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(WRITERS).sort(), `writer modules in the graph:\n${JSON.stringify(seen, null, 1)}`);
  for (const [file, fact] of Object.entries(WRITERS)) {
    const got = seen[file]!;
    assert.deepEqual(got.pure, Object.keys(fact.pure).sort(), `${file}: the names the graph takes are not the ones recorded as pure - record each new one with what it is, after checking it neither writes nor calls a writer`);
    assert.deepEqual(got.passes, Object.fromEntries(Object.entries(fact.passes ?? {}).map(([n, p]) => [n, [...p.by].sort()])), `${file}: a writer is taken by a module not recorded as taking it`);
    for (const p of Object.values(fact.passes ?? {})) for (const by of p.by) {
      assert.ok(Object.hasOwn(WRITERS, by), `${by} takes a writer from ${file} and is not itself listed, so its names go unread`);
      assert.ok(!ROOTS.map(rel).includes(by), `${by} is a page or layout and takes a writer`);
    }
    assert.ok(fact.writes && Object.values(fact.pure).every(Boolean), `${file}: every entry says why`);
  }
});

test("UNCHAINED: the builder method names called on something that is not a .from( chain", () => {
  const seen = [...new Set([...MODS.values()].flatMap((m) => m.unchained.map((u) => `${rel(m.file)} ${u.text}`)))].sort();
  assert.deepEqual(seen, Object.keys(UNCHAINED).sort(), "a .insert/.update/.upsert/.delete the walk cannot place - say what it is");
});

test("CLIENT_SITES: where each client module's site runs", () => {
  const seen = [...MODS.values()].filter((m) => m.client && m.sites.size).map((m) => rel(m.file)).sort();
  assert.deepEqual(seen, Object.keys(CLIENT_SITES).sort());
});

test("nothing in the graph writes at import time", () => {
  assert.deepEqual([...MODS.values()].flatMap((m) => m.moduleSites.map((s) => `${rel(m.file)}:${s.line} ${s.text}`)), []);
});

test("PACKAGES: what the graph imports from outside src", () => {
  const seen = [...new Set([...MODS.values()].flatMap((m) => m.edges.filter((e) => e.from === null).map((e) => e.spec)))].sort();
  assert.deepEqual(seen, Object.keys(PACKAGES).sort(), "a package entered the dashboard's render graph - a vendor client here is a spend on every prefetch");
});

test("no server action in the graph (fresh.ts: one must revalidate the layout)", () => {
  assert.deepEqual([...MODS.values()].filter((m) => m.server).map((m) => rel(m.file)), []);
});

test("census probe: each matcher fires, and the taint carries across a module", () => {
  const f = (name: string) => join(ROOT, "probe", name);
  const resolver = (_from: string, spec: string) => (spec.startsWith("./") ? f(spec.slice(2) + ".ts") : null);
  const sites = (src: string) => [...parse(f("x.ts"), src, resolver).sites.values()].flat().map((s) => s.kind);
  assert.deepEqual(sites(`export const a = (db) => db.from("t").insert({});`), ["db"]);
  assert.deepEqual(sites(`export const a = (db) => db.from("t").select().eq("a", 1).update({});`), ["db"]);
  assert.deepEqual(sites(`export const a = (db) => db.rpc("f");`), ["rpc"]);
  assert.deepEqual(sites(`import { after } from "next/server"; export const a = () => after(() => 1);`), ["after"]);
  assert.deepEqual(sites(`const after = () => 1; export const a = () => after();`), []);
  assert.deepEqual(sites(`export const a = () => fetch("https://x");`), ["fetch"]);
  assert.deepEqual(sites(`export const a = () => runOnDemand({}); export const b = () => enqueueOnboarding({});`), ["queue", "queue"]);
  assert.deepEqual(sites(`export const a = () => sendInvite({});`), ["mail"]);
  assert.deepEqual(sites(`import { writeFileSync } from "node:fs"; export const a = () => writeFileSync("x", "");`), ["fs"]);
  assert.deepEqual(sites(`import { createHmac } from "node:crypto"; export const a = (k, b) => createHmac("sha256", k).update(b).digest("hex");`), []);
  const held = parse(f("x.ts"), `export const a = (db) => { const t = db.table; return t.delete(); };`, resolver);
  assert.deepEqual([held.sites.size, held.unchained.map((u) => u.text)], [0, ["t.delete("]]);
  assert.deepEqual(parse(f("x.ts"), `const q = fetch("/x");`, resolver).moduleSites.map((s) => s.kind), ["fetch"]);
  // b.ts's clean name stays clean beside a writer; a.ts's page that names the writer is tainted through it.
  const mods = new Map<string, Mod>([
    [f("b.ts"), parse(f("b.ts"), `export const pure = 1; export async function write(db) { await db.from("t").upsert({}); } export const wraps = (db) => write(db);`, resolver)],
    [f("a.ts"), parse(f("a.ts"), `import { pure, wraps } from "./b"; export default function Page() { return pure; } export const act = (db) => wraps(db);`, resolver)],
  ]);
  const t = taint(mods);
  assert.deepEqual([t.exportTainted(f("b.ts"), "pure"), t.exportTainted(f("b.ts"), "wraps"), t.exportTainted(f("a.ts"), "default"), t.exportTainted(f("a.ts"), "act")], [false, true, false, true]);
});
