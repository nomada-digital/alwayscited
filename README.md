# alwayscited

The AI search visibility product and its site. Next.js App Router,
TypeScript, Tailwind v4, Supabase, deployed on Vercel.

The brand is always written lowercase, including at the start of a sentence.
The four tiers are `alwaystracked`, `alwaysmentioned`, `alwayscited` and
`alwayseverywhere`, each one lowercase word, rendered through the `TierName`
component. See AGENTS.md - it is the operating manual for this repo and takes
precedence over anything here.

## Running it

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev
```

The bar before every push, because the branch deploys straight to production:

```bash
npx tsc --noEmit && npm run check && npm run build
```

`npm run check` is the test suite - see **Checks** below. Run the build before
the check if you want the real result: several sweeps read the built output
and the capture, and on a tree that has never been built they skip rather than
fail, which looks identical to passing.

## Checks

`npm run check` runs every `src/**/*.test.mts` through `node --test`. A little
over eight hundred tests, and most of them are not unit tests - they are
**censuses**. A census walks the tree and asserts that a recorded fact about
it is still true: which files can send an email, which routes can spend money,
which colours are written outside the palette and how many times each, what
every `.rpc()` call site is, which pages publish a client figure.

That shape is deliberate. The expensive defects in this repo have not been
wrong functions, they have been two copies of one fact drifting apart - a page
advertising five questions while the backend asked fourteen, a bound recorded
in a test for a route that had been deleted. A census fails the day the second
copy appears.

Two rules follow from it, and AGENTS.md states them:

- **Never weaken or delete a rule to get green.** When a change trips a
  census, either the change is wrong or the recorded fact has moved. Update
  the fact, with the reason and the date, in the file that records it.
- **A floor is part of the rule.** Most sweeps assert a minimum count as well
  as a set, because a walk that stops matching reports a clean tree. If you
  narrow a sweep, move its floor deliberately.

`npm run capture` renders the dynamic routes to `.next` so the contrast,
canonical and sitemap sweeps can read them. `npm run build` first.

## The scan

A visitor enters a domain. The site is read, a language model writes the
buying questions, and each question is put to every engine in the free set.
What comes back is stored as measurements - whether the engine answered,
whether it named the brand, and every source it cited - plus what each engine
said, which is kept for as long as the scan is.

`src/lib/scan/` holds the pipeline. `pipeline.ts` runs it, `engines.ts` says
which engines and how to parse each one, `unlock.ts` builds the full report
payload, and `settings.ts` reads the live caps from `app_settings` on every
request so they can be changed without a deploy.

There is no email gate. The result opens on its own link and the only call to
action on it is a walkthrough request.

Two things about it that have cost real time are written up in AGENTS.md: the
domain cache, and how a silent failure in classification can ship a
half-built report. Read those before changing anything in `lib/scan`.

Environment variables are documented in `.env.example`, and turning the scan
on for the first time is documented in `docs/scan-setup.md`.

## The campaign benchmark

`/coverage-check` is the PR-agency tool. A brand, a domain, up to five
coverage URLs and optionally the agency's own prompts; the same engines the
free scan reads; and a result that says, piece by piece, whether an engine
cited that page, the publication it is on, or neither.

A reading **is a scans row** with a `campaign_id` - see
`supabase/migrations/20260920010000_campaign_benchmark.sql`, which argues it at
length. That is why nothing in `src/lib/coverage/` reads an engine, counts a
citation or enforces a ceiling: the scan pipeline already does all of it.

One free reading per client domain per 30 days. A re-run writes a new reading
against the same campaign and never edits the old one, asking the previous
reading's questions so the two are comparable.

## The site

| Route | What it is |
|---|---|
| `/` | The homepage |
| `/scan`, `/scan/[token]` | The scan funnel and a result by its public token |
| `/coverage-check`, `/coverage-check/[token]` | The campaign benchmark and a reading |
| `/alwaystracked` … `/alwayseverywhere` | One page per tier |
| `/white-label`, `/seo-agencies`, `/pr-agencies` | Agency pages |
| `/legal` | Privacy policy |
| `/how-it-works`, `/what-is-aeo`, `/blog`, `/about`, `/contact` | Content |
| `/case-studies/vibe-retail` | The one case study |
| `/admin/scans` | Basic-auth admin: spend, volume, readiness |

`src/config/tokens.ts` holds the design tokens and is the source for anything
rebuilt from the canvas.

`src/config/pricing.ts` is the single source for prices. No page types a
price literal - they all read it from there, so a change moves every surface
at once. `src/config/scan-shape.ts` does the same job for the engine and
question counts, which had gone stale on four surfaces at once before it
existed.

`ProcessSequence` is the four-tier explanation, and it is one component used
in two places - the homepage and the scan waiting screen - because there were
two and they did not agree about what $99 buys.

## Deliverables

On-site changes we recommend and the customer (or we) make, with a Markdown file to copy, a tick, and a permanent paper trail: see [docs/deliverables.md](docs/deliverables.md). Customers see them under Deliverables in the dashboard; staff create and publish them at `/admin/deliverables` or through the `deliverable_*` actions on `/api/hub/agency`.

## What may not be published

AGENTS.md has the full list. The two that catch people:

- **A number about a client's result, a claim about a competitor, or a
  statement about what an engine does** carries `[VERIFY]` until there is a
  dated source. `src/config/client-results.ts` holds every attested figure
  with who stood behind it and when, and a census fails if a surface prints
  one without its scope.
- **Verified means verified** - a checksum, a build log, a page actually read,
  or a test that ran. Not reasoned about.

## The site is itself an AEO target

FAQPage and Article schema, question-format headings, real `<table>` markup
for comparisons, and every AI crawler allowed in `robots.txt`. The homepage's
FAQ schema is generated from the same array the page renders, so the markup
and the visible answers cannot drift apart.

## Still open

Tracked in `docs/blocked.md`, one question each, and in `docs/state.md`. The
short version: weekly tracking (Phase 3, not built), a comparison page that
needs competitor facts with dates on them, per-sector prices, and terms of
service.
