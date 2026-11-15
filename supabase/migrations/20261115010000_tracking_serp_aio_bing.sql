-- The Google rankings view (Danny, 15 Nov 2026): each tracked keyword's AI Overview and its Bing position, read by the
-- daily run beside the Google position (src/lib/tracking/runner.ts).
-- aio_shown: an AI Overview showed on the Google page (null: not read for it); aio_sources: the sites it cites,
-- from the same paid response, at no extra cost.
-- bing_*: Bing organic, mobile, depth 20 (the hub's Bing read), a page checked to be the search asked for (engines.ts bingPageMatches)
-- and read up to 3 times; bing_read false is a Bing read that never came right (no reading, not "not ranking").
-- Additive; null on every row read before it.
alter table public.tracking_serp
  add column if not exists aio_shown boolean,
  add column if not exists aio_sources text[],
  add column if not exists bing_position integer,
  add column if not exists bing_url text,
  add column if not exists bing_top jsonb,
  add column if not exists bing_read boolean,
  add column if not exists bing_cost numeric(10,4);
