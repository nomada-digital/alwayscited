# Link overrides: marking placements and link insertions live by hand

Built 25 Nov 2026. WLDM keeps the "AlwaysCited- Backlink Tracker" sheet and is sometimes slow to update it, so a link can be live for days and still show "in progress" on the customer's **Your links** page. The team can now correct that from `/admin/links`, and the sheet sync will not undo it.

## Where the data lives

| What the customer sees | Where it comes from | Table |
|---|---|---|
| Placements and link insertions, with a status | the WLDM tracker, synced by the hub (`sheet_cells` -> `lib/links/sheet-store.ts`) | `sheet_links` (one row per live URL: `kind`, `url_key`, `status`, ...) |
| Placements in progress (written, awaiting) | Kev's master sheet, `placements_sync` (`lib/agency/sheet-placements.ts`) | `placements_in_progress`, and `placements` once live |

The tracker's rows (the Common Agency / agilityportal.io case) are `sheet_links`, not `placements` or `placements_in_progress`.

## How an override works

`link_overrides` (migration `20261125010000_link_overrides.sql`) holds one **current** override per item: `source` (`sheet_link` or `progress`), `kind`, `item_key` (the row's `url_key`, or the sheet's `NOM-0000`), the `status` wording, `live_url`, `anchor_text`, `live_on`, an internal `note`, the last `link_check`, and `active`.

- **Sheet links:** the customer's read (`readLinks`) applies the active override over the sheet's row. The sync is untouched, so it cannot revert it. After each sync, `clearAgreed` sets `active = false` for any override whose item the sheet now reads the same way (same stage, and for a live item the same page).
- **In-progress items:** `placements_sync` skips an overridden item, and clears the override when the sheet reads it the same way. Marking one live adds the live `placements` row (as Find placements' Mark live does) and moves it out of in-progress.
- **"Differs from WLDM sheet":** the admin view shows it while an override is active and the sheet does not agree. It, the note and the link check are never in anything the customer's page reads.
- **Cleared means the sheet is the truth again.** If the sheet later goes backwards (say, Lost), the customer sees that.

Stages you can set: Content written, Awaiting publication (in progress), Published, Live (live), Not live. Live and Published need a live URL; the live date defaults to today and cannot be in the future.

## Audit trail

Every change is a line in the existing `agency_edits` table: who, the action (`link_mark_live`, `link_set_stage`, `link_check`, `link_override_cleared`), the item, the old and new value, and when. `/admin/links` lists the recent ones.

## Link check

When something is marked live the server fetches the URL and looks for a link to the customer's domain (or a subdomain), showing pass or fail with the href, anchor and rel. The fetch is guarded: http/https only, no private or loopback addresses (also after DNS and on every redirect), 3MB and 12s caps. A failed check is shown and recorded; it does not block the change (the team may know better, or the page may block our fetch). "Re-check the link" runs it again.

## Using it

- Screen: `/admin/links?slug=<customer-slug>` (the `/admin` Basic auth). "Mark as live" on any in-progress item; "Edit stage, URL or anchor" for the rest.
- API (hub, Dispatch, Noma), `POST /api/hub/agency`, `x-hub-secret` or `x-ac-key`, `by` a `@nomadadigital.co.uk` address:

```bash
curl -sS https://alwayscited.com/api/hub/agency -H "content-type: application/json" -H "x-hub-secret: $HUB_OFFER_SECRET" -d '{
  "action": "links_set", "slug": "<customer-slug>", "by": "kev@nomadadigital.co.uk",
  "source": "sheet_link", "kind": "placement", "key": "<url_key, e.g. agilityportal.io/blog/best-cms-for-intranet>",
  "status": "Live", "live_url": "https://agilityportal.io/blog/best-cms-for-intranet", "anchor_text": "craft cms agency",
  "note": "optional, internal"
}'
```

`links_list` ({slug}) returns every in-progress or overridden item with its `key`; `links_check` re-runs the check. Before the migration is applied everything behaves as before and `links_set` says it cannot save.
