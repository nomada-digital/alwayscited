# Deliverables

On-site changes alwayscited recommends and cannot make itself, because it has no access to the customer's site. First use: a customer's own website changes, written as copy-paste prompts. Built 25 Nov 2026.

A deliverable is a title, a short findings summary (Markdown), one or more text files (the first Markdown one is what the customer copies or downloads), an optional evidence link, **who delivers it** (`client` or `nomada`) and a status: `proposed` -> `delivered` (we have handed it over) -> `completed`.

## Where it lives

- Customer: the **Deliverables** item in the dashboard sidebar, `dashboards.alwayscited.com/<slug>/deliverables`. It appears only once something has been shared with that customer. Sections: *For you to do*, *We are making these*, *Completed*.
- Internal: `/admin/deliverables` (same Basic auth as the rest of `/admin`), and the `deliverable_*` actions on `/api/hub/agency` for Dispatch, Noma and the hub.
- Code: `src/lib/deliverables/` (`core.ts` rules and wording, `store.ts` reads and writes, `agency.ts` the API actions, `sample.ts` the demo's rows), `src/components/dash/DeliverableCard.tsx`, `src/app/dashboards/[client]/deliverables/page.tsx`, `src/app/api/dash/[client]/deliverables/route.ts` (the customer's tick), `src/app/admin/deliverables/`.
- Schema: `supabase/migrations/20261125000000_deliverables.sql`. **Not applied yet** (see below).

### Why a new table and not `plan_items`

`plan_items` is the Actions engine's table: closed `kind` and `status` lists, 200-character title and note, and a nightly refresh that drops a row it has not gathered twice. A deliverable is hand-written, long, has a status `plan_items` lacks, and must never be dropped. Widening those checks means dropping constraints on a live table, which is not additive. So a deliverable is its own row; `deliverables.plan_item_id` points at the `plan_items` row it answers when there is one (optional, `on delete set null`).

## The paper trail

Enforced in the database, not in the app:

| What | Rule |
|---|---|
| `deliverable_versions`, `deliverable_files`, `deliverable_events` | insert only. A trigger refuses any update or delete, for anyone, including the service role. |
| `deliverables` | holds state only (status, visibility, who, when, which version is current). The content is in the version `current_version` names. |
| An edit | a **new version** carrying the whole content again (title, findings, evidence link, files). Earlier versions stay. A reason is required and kept. A stale edit (someone else saved first) is refused, not merged. |
| Every change of status, visibility or version | writes an event in the same statement, with the actor, their kind (`customer`, `nomada`, `system`), a note and a link. Done by trigger from the `changed_*` columns every update carries, so a change made by hand in SQL leaves the same trail. |
| Foreign keys | all `on delete restrict`. A deliverable, its history, and a customer who has deliverables cannot be deleted. A draft that should not be seen stays hidden (`visible_to_customer = false`). |
| Status | only moves forward. Completing a `nomada` deliverable needs an evidence link (a check constraint). |
| Visibility | `visible_to_customer` defaults false and a row cannot be inserted visible: publishing is an update. |

Files are text (`.md`, `.txt`, `.csv`, `.json`, 400KB each, 8 per version) kept in the row. Binary files are not supported; put a screenshot in a Drive folder and use the evidence link.

## Flows

**Client-actioned** (`delivered_by: client`). We create it (hidden), Danny approves with **Publish to customer**, we may **Mark delivered** (handed over). The customer sees a *Mark as done* tick with optional note and live-page link. Ticking records who and when (stamped by the database), flips it to Completed, and posts to #alwayscited naming Kev (`config/team.ts` ACCOUNT_MANAGER, the same notice path plan swaps use, `lib/slack.ts`). The Slack post is a no-op that logs until `SLACK_BOT_TOKEN` exists; the tick is saved either way. There is no account-owner field on a customer, so the notice goes to Kev. Owners and editors can tick; viewers, demo links and the hub's view-as cannot.

**Nomada-actioned** (`delivered_by: nomada`). Our team marks it completed from the internal side with a required evidence link (a sheet or URL). The customer sees it completed with that link, and has no tick.

**Drafts.** Nothing is visible to a customer until published. `/admin/deliverables/preview/<id>` shows a draft exactly as the customer will see it.

## Creating one (Dispatch, Noma, the hub)

`POST https://alwayscited.com/api/hub/agency`, JSON, server to server. Auth is the hub's: header `x-hub-secret` (HUB_OFFER_SECRET) or `x-ac-key` (the project's service key). `by` must be a `@nomadadigital.co.uk` address and is written to the trail. `slug` is the customer's dashboard slug. Every answer is `{ ok, message, data? }`.

```bash
# Create, hidden from the customer. Markdown inline (named from the title), or "files": [{ "filename", "body" }, ...]
curl -sS https://alwayscited.com/api/hub/agency \
  -H "content-type: application/json" -H "x-hub-secret: $HUB_OFFER_SECRET" \
  -d '{
    "action": "deliverable_create",
    "slug": "<customer-slug>",
    "by": "dispatch@nomadadigital.co.uk",
    "delivered_by": "client",
    "title": "Add FAQ schema to the services page",
    "findings": "## What we found\n\n- The page has the answers but no FAQ markup.",
    "evidence_url": "https://docs.google.com/spreadsheets/d/...",
    "markdown": "# Prompt 1\n\n```\nAdd FAQPage JSON-LD to /services ...\n```",
    "filename": "services-faq-prompts.md"
  }'
# -> {"ok":true,"message":"Created for <domain>, hidden from the customer until you publish it.","data":{"id":"<uuid>","visible_to_customer":false}}
```

| action | fields | does |
|---|---|---|
| `deliverable_list` | `slug` | every deliverable of the customer, drafts, every version and event |
| `deliverable_create` | `slug, by, delivered_by, title, findings, files` or `markdown` (+`filename`), `evidence_url?`, `plan_item_id?` | creates version 1, hidden |
| `deliverable_edit` | `slug, by, id, title, findings, reason, evidence_url?, files?, expect?` | a new version; no `files` keeps the current files; `expect` is the version you read (default: current) |
| `deliverable_publish` / `deliverable_unpublish` | `slug, by, id` | shows it to the customer / back to a draft |
| `deliverable_deliver` | `slug, by, id, note?` | status `delivered` |
| `deliverable_complete` | `slug, by, id, evidence_url, note?` | status `completed`; the link is required for `nomada` items |

The form at `/admin/deliverables` runs the same code (`lib/deliverables/agency.ts`), so the form and the API cannot disagree. Danny's approval is the **Publish to customer** step: Dispatch and Noma create, Danny publishes.

## Applying it

1. `supabase db push` (additive: four tables, five functions, triggers; re-runnable). Verify by reading the tables back; `select count(*) from deliverables` should answer 0.
2. Create the customer's first deliverable (hidden), preview it at `/admin/deliverables/preview/<id>`, then Publish.

The dashboard degrades before the migration lands: the sidebar item stays hidden and the page says it could not read, rather than reading as empty.

## Tests

`src/lib/deliverables/deliverables.test.mts`: the rules, the markdown subset (links must pass `cleanUrl`, fences stay literal), the sample, and the migration read as text (history guards, forward-only status, nomada evidence, additive-only, every function revoked from public and granted by signature). The migration itself was also run on a real Postgres (PGlite), re-applied, and every guard exercised, and the store was run through create, publish, edit, deliver, tick, evidence and unpublish against it.
