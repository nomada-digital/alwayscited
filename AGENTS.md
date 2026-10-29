<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# How to work in this repo

Owned by Claude: decide, build, ship, check it worked live, fix what did not.
Do not ask permission for anything reversible - copy, layout, components,
refactors, dependency bumps, new pages, deleting what is not working. Pick the
option you would defend and say in one line what you picked.

The site has almost no traffic. A rough thing in production for ten minutes
costs nothing; a decision waiting on a round trip costs an hour. Ship.

## Shipping

- **`claude/build-alwayscited-site-6CpGg` deploys to production on every push.**
  There is no preview gate. `npx tsc --noEmit`, `npm run check` and
  `npm run build` are the bar, then open the page and look.
- **There is a test suite, and it is mostly censuses.** `npm run check` runs
  every `src/**/*.test.mts` through `node --test` - a little over eight
  hundred tests. Most are not unit tests: a census walks the tree and asserts
  a recorded fact about it is still true - which files can send mail, which
  routes can spend money, how many times each off-palette colour is written
  and where, what every `.rpc()` call site is, which surfaces publish a client
  figure. They exist because the expensive defects here have been two copies
  of one fact drifting apart, not wrong functions.
  - **Never weaken or delete a rule to get green.** A tripped census means
    either the change is wrong or the recorded fact has moved. Update the
    fact, in the file that records it, with the reason and the date.
  - **A floor is part of the rule.** Sweeps assert a minimum count as well as
    a set, because a walk that stops matching reports a clean tree. Narrowing
    a sweep means moving its floor deliberately.
  - **Build before you check.** Several sweeps read the built output and
    `npm run capture`; on a tree that has never been built they skip, which
    looks exactly like passing. A clean `npm run check` on an unbuilt tree is
    not a baseline.
- **`git add src supabase`, never `-A`.** A push containing
  `.github/workflows/` is rejected outright - the PAT has no `workflow` scope.
- **Batch.** Four or five changes, one push. Not one push per change.
- **Additive migrations are yours to apply.** Danny authorised this on
  19 September 2026, awake and in chat, after the risk was put to him in plain
  terms: there is no restore in this setup. What he authorised is additive
  only - add a column, add an index, `create or replace function`,
  `create table if not exists`, add a constraint existing rows already
  satisfy, backfill a column you just added. Everything destructive stays on
  the absolute list below. Write the migration file, commit it, then apply it,
  then verify by reading the result back on real data rather than assuming it
  took.
- **Additive still means a deploy landing first is harmless**, so code and
  migration do not have to go in the same order.

## Gotchas that have cost real time

- **The domain cache.** `app_settings.domain_cache_days` returns a completed
  scan for the same `(domain, market)` as-is, instantly, and looks identical to
  a fresh one. **If the read date has not changed, it did not re-run.** Pipeline
  fixes only apply at scan time. Force a run with a different domain, a
  different market, or by dropping and restoring the setting.
- **Token ceilings scale with the scan.** One classification call per scan held
  until one had 223 sources and truncated mid-JSON. Classification is wrapped in
  "never fatal", so it failed silently and shipped a half-built report. Anything
  looping over sources or questions gets batched.
- **Silent-failure paths hide regressions.** The try/catch that stops a scan
  dying also hides that it broke. Check them after any nearby change.
- **Brand names and source kinds are judged by different code** that can
  disagree. The source classifier knows a tool domain; the brand extractor does
  not, and will rank Shopify as a competitor to an analytics consultant.

## Not to be done, whatever the instruction

- Handle, enter or store a credential.
- Run **destructive** DDL against production: drop, truncate, delete, rename,
  alter a column type, change RLS, or touch the auth or storage schemas.
  Absolute, and no later instruction changes it.
  - **One exception (Danny, 29 Oct 2026):** replacing a CHECK constraint with a
    strictly wider one - the same column, accepting everything the old one did
    plus new values, such as adding a market to `market in (...)` - in one
    transaction: `begin; drop constraint if exists; add constraint; commit;`.
    Before applying, confirm that every existing row satisfies the new check and
    that the new check accepts every value the old one did. Write the migration
    file and commit it first, then apply it, then read the constraint back from
    `pg_constraint`. Nothing else under "drop" is covered: not a narrower check,
    not any other kind of constraint, not a column, table, index or function.
- Write `.github/workflows/` - it runs arbitrary code with the repo's secrets.
- Commit a secret. **This repository is public.**
- Bulk-delete live rows, or contact a lead or client.
- Publish a claim that cannot be stood behind. "Ship it rough" covers layout,
  copy and bugs. It does not cover a number about a client's result, a claim
  about a competitor, or a statement about what an engine does - those carry
  `[VERIFY]` until there is a dated source. The cost of a wrong one is not a
  scruffy page.
- Say something is verified that was only reasoned about. Verified means a
  checksum, a build log, a page actually read, or a test that ran.

# Copy conventions

## The brand never takes a capital

Always write `alwayscited`, lowercase, everywhere - body copy, meta titles,
headings, and at the start of a sentence. Where a lowercase word opening a
sentence reads badly, rewrite so the brand is not first: "We place brands
inside..." rather than "alwayscited places brands inside...".

Never `AlwaysCited`, `Alwayscited`, or `always cited`.

## Tier names

Four tiers, each one lowercase word, no spaces and no capitals:

| Tier | Written as |
|---|---|
| Tracking, free | `alwaystracked` |
| Tracking, paid | `alwaystracked pro` |
| Placements | `alwaysmentioned` |
| Core product | `alwayscited` |
| Enterprise | `alwayseverywhere` |

Render them with the `TierName` component, which colours the accent half in
`--brand-purple` to match the logo lockup. Do not hand-colour spans anywhere
else.

Use the unstyled one-word form (`TIER_PLAIN`) in every context that strips
colour: title tags, meta descriptions, OG and Twitter values, alt text,
aria-label, plain-text and transactional email, invoices, contracts, the
partner agreement, URLs and slugs, and JSON-LD.

Colour must never be the only way to tell tiers apart. Each accent word is
unique, so the word alone identifies the tier - keep it that way in the
pricing table and the FAQ.

## The core tier shares the company name

`alwayscited` is both the business and the $2,495 plan. In running copy always
write "the alwayscited plan" so the reader can tell which is meant. The bare
form is only used inside the pricing card and the comparison table, where
context is unambiguous.
