/**
 * A sample client, generated rather than stored (29 Oct 2026).
 *
 * Luke's Jamaican agency asked to see the client dashboard as if it had been
 * running for months, on tourism. No real client can be shown to them, so this
 * is a fictional brand - Blue Mahoe Retreats, bluemahoeretreats.com, which does
 * not resolve - with every reading made up here, deterministically from the
 * day, so a reload draws the same figures and tomorrow adds one more day.
 *
 * Nothing is written anywhere. `demoRaw` (access.ts) returns this for
 * SAMPLE_SLUG before it reads the database, and the click-through reads in
 * history.ts take it for SAMPLE_CLIENT_ID. The Shell labels every page as
 * sample data; the competitors and placement sites are invented too, and the
 * publishers the answers cite are real names with made-up paths, so no figure
 * here is a claim about anybody.
 *
 * Pure, so `node --test` runs it (sample-world.test.mts).
 */

import { SAMPLE_CLIENT_ID, SAMPLE_SLUG } from "./host.ts";
import type { Citation, Day, Engine, FootRow, Raw, RawAnswer, RawCluster, RawKeyword, RawOpportunity, RawPlacement, RawPrompt, RawRun, RawSerp } from "./types.ts";
import type { KeyPageRow } from "./target.ts";

export const SAMPLE_BRAND = "Blue Mahoe Retreats";
export const SAMPLE_DOMAIN = "bluemahoeretreats.com";

/** How long the sample has been running, in days. */
export const SAMPLE_DAYS = 165;

const ENGINES: Engine[] = ["google_aio", "chatgpt", "gemini", "perplexity", "claude"];
/** How often each engine names the brand, against the cluster's rate. Google's Overview also often does not appear. */
const ENGINE_LEAN: Record<Engine, { named: number; answered: number }> = {
  google_aio: { named: 0.8, answered: 0.74 },
  chatgpt: { named: 1.1, answered: 0.98 },
  gemini: { named: 0.9, answered: 0.97 },
  perplexity: { named: 1.25, answered: 0.99 },
  claude: { named: 0.75, answered: 0.98 },
};

/** Invented, every one of them. Ordered by how often the engines name them, the first most. */
const RIVALS = [
  "Montego Palms Resort", "Negril Sands Hotel", "Ocho Rios Cove", "Treasure Bay Lodge", "Port Antonio House",
  "Saltwater Villas", "Coral Reef Hideaway", "Seven Mile Retreat", "Hibiscus Hill Hotel", "Rio Grande Lodge",
];

/** Real publishers, made-up paths. */
const SOURCES: { domain: string; path: string; title: string }[] = [
  { domain: "tripadvisor.com", path: "/Hotels-g147309-Jamaica-Hotels.html", title: "Jamaica hotels - traveller reviews" },
  { domain: "cntraveler.com", path: "/gallery/best-hotels-in-jamaica", title: "The best hotels in Jamaica" },
  { domain: "travelandleisure.com", path: "/jamaica-travel-guide", title: "Jamaica travel guide" },
  { domain: "visitjamaica.com", path: "/places-to-stay/", title: "Places to stay in Jamaica" },
  { domain: "lonelyplanet.com", path: "/jamaica/hotels", title: "Where to stay in Jamaica" },
  { domain: "reddit.com", path: "/r/JamaicaTravel/comments/sample/where_to_stay/", title: "Where to stay in Jamaica that isn't a big resort?" },
  { domain: "fodors.com", path: "/world/caribbean/jamaica/hotels", title: "Jamaica hotels" },
  { domain: "booking.com", path: "/country/jm.html", title: "Hotels in Jamaica" },
  { domain: "timeout.com", path: "/jamaica/hotels/best-hotels-in-jamaica", title: "The best hotels in Jamaica" },
];

/** Invented sites for the placements: nothing we placed, anywhere. */
const PLACE_SITES = ["islandtravelnotes.com", "caribbeanescapesmag.com", "honeymoonplannerblog.com", "villastaysjournal.com", "slowtravelcaribbean.com"];

type ClusterSpec = {
  key: string;
  name: string;
  /** Days after the sample's start that this cluster began. */
  from: number;
  rate: [number, number];
  page: string;
  head: { keyword: string; volume: number; pos: [number, number] };
  keywords: { keyword: string; volume: number; pos: [number, number] }[];
  prompts: string[];
  theme: string;
};

const CLUSTERS: ClusterSpec[] = [
  {
    key: "boutique",
    name: "Boutique hotels in Jamaica",
    from: 0,
    rate: [0.06, 0.42],
    page: "/boutique-hotel",
    head: { keyword: "boutique hotels jamaica", volume: 1900, pos: [31, 6] },
    keywords: [
      { keyword: "best boutique hotels in jamaica", volume: 880, pos: [44, 9] },
    ],
    prompts: [
      "What are the best boutique hotels in Jamaica?",
      "Which small luxury hotels in Jamaica are worth booking?",
      "Recommend a quiet boutique hotel in Negril for couples",
      "Where should I stay in Jamaica for a relaxed, upscale trip away from big resorts?",
      "Best adults-only boutique stays in Jamaica",
    ],
    theme: "a boutique stay in Jamaica",
  },
  {
    key: "villas",
    name: "Private villas in Jamaica",
    from: 21,
    rate: [0.04, 0.38],
    page: "/villas",
    head: { keyword: "luxury villas jamaica", volume: 1300, pos: [48, 11] },
    keywords: [
      { keyword: "jamaica villa rentals with chef", volume: 590, pos: [37, 8] },
    ],
    prompts: [
      "Best luxury villa rentals in Jamaica",
      "Which Jamaica villa companies include a private chef?",
      "Recommend a private villa in Montego Bay for a family of six",
      "Is it better to rent a villa or stay at a resort in Jamaica?",
      "Who are the most reliable villa rental companies in Jamaica?",
    ],
    theme: "a private villa in Jamaica",
  },
  {
    key: "honeymoon",
    name: "Jamaica honeymoons",
    from: 95,
    rate: [0.0, 0.28],
    page: "/honeymoon",
    head: { keyword: "jamaica honeymoon resorts", volume: 2400, pos: [67, 19] },
    keywords: [
      { keyword: "romantic hotels jamaica", volume: 720, pos: [55, 16] },
    ],
    prompts: [
      "Best places to honeymoon in Jamaica",
      "Most romantic hotels in Jamaica",
      "Plan a 7-night Jamaica honeymoon with a private villa",
      "Which Jamaica resorts are best for a honeymoon that isn't all-inclusive?",
      "Where do couples stay in Jamaica for privacy?",
    ],
    theme: "a honeymoon in Jamaica",
  },
];

/** FNV-1a to 0..1: the same input always draws the same number, on any machine. */
function rand(s: string): number {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return (x % 100_000) / 100_000;
}

function addDays(d: Day, n: number): Day {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 at the start, 1 at the end, slow then steady and still climbing: the shape a campaign's results take. */
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(t, 1.3));

const promptId = (c: ClusterSpec, i: number) => `sample-${c.key}-p${i + 1}`;
const keywordId = (c: ClusterSpec, i: number) => `sample-${c.key}-k${i}`;
const clusterId = (c: ClusterSpec) => `sample-${c.key}`;

/** Every placement on the sample, by day after the cluster began. Statuses follow from the day. */
function placementsFor(c: ClusterSpec, start: Day, today: Day): RawPlacement[] {
  const plan: { kind: RawPlacement["kind"]; at: number; site: number }[] = [
    { kind: "on_site", at: 18, site: -1 },
    { kind: "guest_post", at: 40, site: 0 },
    { kind: "link_insertion", at: 62, site: 1 },
    { kind: "guest_post", at: 85, site: 2 },
    { kind: "link_insertion", at: 110, site: 3 },
    { kind: "guest_post", at: 140, site: 4 },
  ];
  const began = addDays(start, c.from);
  return plan.map((p, i): RawPlacement => {
    const on = addDays(began, p.at);
    const domain = p.site < 0 ? SAMPLE_DOMAIN : PLACE_SITES[(p.site + CLUSTERS.indexOf(c)) % PLACE_SITES.length]!;
    const ahead = Math.round((Date.parse(on) - Date.parse(today)) / 86_400_000);
    const status: RawPlacement["status"] = ahead <= 0 ? "live" : ahead <= 10 ? "scheduled" : ahead <= 30 ? "writing" : "pitched";
    return {
      id: `sample-${c.key}-pl${i + 1}`,
      sample: true,
      cluster_id: clusterId(c),
      kind: p.kind,
      url: `https://${domain}${p.site < 0 ? c.page : `/${c.key}-jamaica-guide-${i + 1}`}`,
      domain,
      status,
      scheduled_on: status === "live" ? null : on,
      live_on: status === "live" ? on : null,
      anchor_text: status === "live" ? SAMPLE_BRAND : null,
    };
  });
}

/** The answer's words, for the prompt page: the brands it names, in order. */
export function sampleAnswerText(theme: string, brands: readonly string[]): string {
  if (!brands.length) return `There is no single answer for ${theme}; it depends on the area and the budget.`;
  const lines = brands.map((b, i) => `${i + 1}. ${b} - ${i === 0 ? "a frequent recommendation" : i % 2 ? "well reviewed for service" : "popular for its setting"}.`);
  return `For ${theme}, these come up most:\n\n${lines.join("\n")}\n\nBook early for December to April.`;
}

/** The theme a sample prompt's answer is written around, for its words (history.ts answerWords). */
export function sampleTheme(promptIdOf: string): string {
  return CLUSTERS.find((c) => promptIdOf.startsWith(`sample-${c.key}-`))?.theme ?? "a stay in Jamaica";
}

const memo = new Map<Day, Raw>();

/** The sample client's rows as they stand on `today`. */
export function sampleRaw(today: Day): Raw {
  const had = memo.get(today);
  if (had) return had;
  const start = addDays(today, -SAMPLE_DAYS);

  const clusters: RawCluster[] = [];
  const keywords: RawKeyword[] = [];
  const prompts: RawPrompt[] = [];
  const serp: RawSerp[] = [];
  const answers: RawAnswer[] = [];
  const placements: RawPlacement[] = [];
  const keyPages: KeyPageRow[] = [];

  for (const c of CLUSTERS) {
    const began = addDays(start, c.from);
    const span = SAMPLE_DAYS - c.from;
    clusters.push({ id: clusterId(c), name: c.name, keyword_id: keywordId(c, 0), tier: "cited", started_on: began, stopped_on: null });
    keyPages.push({ url: `https://${SAMPLE_DOMAIN}${c.page}`, origin: "member", cluster_ids: [clusterId(c)], added_on: began, removed_on: null });
    const placed = placementsFor(c, start, today);
    placements.push(...placed);

    [c.head, ...c.keywords].forEach((k, i) => {
      keywords.push({ id: keywordId(c, i), keyword: k.keyword, search_volume: k.volume, intent: "commercial", added_on: began, stopped_on: null, cluster_id: clusterId(c), group_id: null, form: "primary", pair_of: null, added_by: "nomada" });
      for (let d = 0; d <= span; d++) {
        const day = addDays(began, d);
        const noise = (rand(`${k.keyword}|${day}`) - 0.5) * 4;
        const p = Math.round(k.pos[0] + (k.pos[1] - k.pos[0]) * ease(d / span) + noise);
        serp.push({ run_date: day, keyword_id: keywordId(c, i), position: p > 100 ? null : Math.max(1, p), url: p > 100 ? null : `https://${SAMPLE_DOMAIN}${c.page}` });
      }
    });

    c.prompts.forEach((text, i) => {
      const id = promptId(c, i);
      prompts.push({ id, text, cluster_id: clusterId(c), group_id: null, angle: null, added_on: began, stopped_on: null, origin_kind: null, allowance: null });
      const lean = 0.65 + rand(`${id}|lean`) * 0.7;
      for (let d = 0; d <= span; d++) {
        const day = addDays(began, d);
        // Each placement live by now lifts the rate a little on top of the curve.
        const liveNow = placed.filter((p) => p.live_on && p.live_on <= day);
        const base = c.rate[0] + (c.rate[1] - c.rate[0]) * ease(d / span);
        for (const engine of ENGINES) {
          const r = (what: string) => rand(`${id}|${engine}|${day}|${what}`);
          const answered = r("answered") < ENGINE_LEAN[engine].answered;
          // Mostly a fixed draw per prompt and engine with a little daily wobble, so once an engine starts naming the
          // brand for a prompt it mostly keeps doing so, and the rate climbs rather than jitters.
          const draw = 0.85 * rand(`${id}|${engine}|named`) + 0.15 * r("named");
          const named = answered && draw < Math.min(0.92, base * ENGINE_LEAN[engine].named * lean + liveNow.length * 0.012);
          let brands: string[] = [];
          const citations: Citation[] = [];
          if (answered) {
            // The first rivals named most, as a real category has its leaders.
            brands = RIVALS.filter((name, k) => r(name) < 0.85 - k * 0.07).slice(0, 6);
            if (named) brands.splice(Math.floor(r("at") * Math.min(3, brands.length)), 0, SAMPLE_BRAND);
            const m = 2 + Math.floor(r("m") * 3);
            const srcs = [...SOURCES].sort((a, b) => rand(`${a.domain}|${id}`) - rand(`${b.domain}|${id}`)).slice(0, m);
            srcs.forEach((s, k) => citations.push({ url: `https://www.${s.domain}${s.path}`, title: s.title, source_domain: s.domain, position: k + 1 }));
            for (const p of liveNow) if (p.domain !== SAMPLE_DOMAIN && r(p.id) < 0.3) citations.push({ url: p.url, title: `${c.name}: where to stay`, source_domain: p.domain, position: citations.length + 1 });
            if (named && r("own") < 0.45) citations.push({ url: `https://${SAMPLE_DOMAIN}${c.page}`, title: SAMPLE_BRAND, source_domain: SAMPLE_DOMAIN, position: citations.length + 1 });
          }
          answers.push({ run_date: day, question_id: id, engine, answered, named, brands, citations });
        }
      }
    });
  }

  const runs: RawRun[] = [];
  for (let d = 0; d <= SAMPLE_DAYS; d++) runs.push({ run_date: addDays(start, d), status: "complete", engines: [...ENGINES] });

  const footRows: FootRow[] = [
    ...CLUSTERS.flatMap((c) => [c.head, ...c.keywords].map((k) => ({ k: k.keyword, p: k.pos[1] + 2, u: `https://${SAMPLE_DOMAIN}${c.page}`, v: k.volume, i: "commercial" }))),
    { k: "blue mahoe retreats", p: 1, u: `https://${SAMPLE_DOMAIN}/`, v: 90, i: "navigational" },
    { k: "negril cliff villas", p: 12, u: `https://${SAMPLE_DOMAIN}/villas`, v: 260, i: "commercial" },
    { k: "jamaica villa with pool", p: 21, u: `https://${SAMPLE_DOMAIN}/villas`, v: 320, i: "commercial" },
    { k: "quiet hotels jamaica", p: 15, u: `https://${SAMPLE_DOMAIN}/boutique-hotel`, v: 210, i: "commercial" },
  ];

  const opp = (o: Omit<RawOpportunity, "status" | "evidence"> & { prompts: string[]; competitors: string[]; engines: Engine[]; answers: number }): RawOpportunity => ({
    id: `sample-opp-${o.domain}`,
    cluster_id: o.cluster_id,
    lens: o.lens,
    url: o.url,
    domain: o.domain,
    title: o.title,
    route: o.route,
    status: "new",
    evidence: { engines: o.engines, answers: o.answers, competitors: o.competitors, last_cited: addDays(today, -1), prompt_count: o.prompts.length },
  });
  const [b, v, h] = CLUSTERS as [ClusterSpec, ClusterSpec, ClusterSpec];
  const opportunities: RawOpportunity[] = [
    opp({ cluster_id: clusterId(b), lens: "lists", route: "ask_added", url: "https://www.cntraveler.com/gallery/best-hotels-in-jamaica", domain: "cntraveler.com", title: "The best hotels in Jamaica", prompts: [promptId(b, 0), promptId(b, 1)], competitors: RIVALS.slice(0, 4), engines: ["chatgpt", "perplexity"], answers: 9 }),
    opp({ cluster_id: clusterId(b), lens: "threads", route: "answer_thread", url: "https://www.reddit.com/r/JamaicaTravel/comments/sample/where_to_stay/", domain: "reddit.com", title: "Where to stay in Jamaica that isn't a big resort?", prompts: [promptId(b, 3)], competitors: RIVALS.slice(2, 5), engines: ["perplexity", "gemini"], answers: 6 }),
    opp({ cluster_id: clusterId(v), lens: "profiles", route: "get_listed", url: "https://www.tripadvisor.com/Hotels-g147309-Jamaica-Hotels.html", domain: "tripadvisor.com", title: "Jamaica hotels - traveller reviews", prompts: [promptId(v, 0), promptId(v, 4)], competitors: RIVALS.slice(4, 8), engines: ["google_aio", "chatgpt", "perplexity"], answers: 14 }),
    opp({ cluster_id: clusterId(v), lens: "cited", route: "offer_resource", url: "https://www.visitjamaica.com/places-to-stay/", domain: "visitjamaica.com", title: "Places to stay in Jamaica", prompts: [promptId(v, 3)], competitors: RIVALS.slice(5, 9), engines: ["gemini"], answers: 4 }),
    opp({ cluster_id: clusterId(h), lens: "lists", route: "ask_added", url: "https://www.travelandleisure.com/jamaica-travel-guide", domain: "travelandleisure.com", title: "Jamaica travel guide", prompts: [promptId(h, 0), promptId(h, 1)], competitors: RIVALS.slice(0, 3), engines: ["chatgpt", "claude"], answers: 7 }),
    opp({ cluster_id: clusterId(h), lens: "own", route: "publish_own", url: `https://${SAMPLE_DOMAIN}/honeymoon`, domain: SAMPLE_DOMAIN, title: null, prompts: [], competitors: [], engines: [], answers: 0 }),
  ];

  const raw: Raw = {
    client: {
      id: SAMPLE_CLIENT_ID,
      slug: SAMPLE_SLUG,
      domain: SAMPLE_DOMAIN,
      brand: SAMPLE_BRAND,
      market: "US",
      tier: "cited",
      status: "active",
      started_on: start,
      cluster_limit: 10,
      trial_ends_at: null,
      payment_status: "paid",
      brand_aliases: [],
    },
    role: "owner",
    today,
    clusters,
    groups: [],
    keywords,
    prompts,
    runs,
    serp,
    answers,
    footprint: { pulled_on: addDays(today, -(Number(today.slice(8, 10)) - 1)), rows: footRows },
    opportunities,
    placements,
    connections: [],
    consoleRows: [],
    groupsReady: true,
    keyPages,
    localGrids: 0,
  };
  memo.clear();
  memo.set(today, raw);
  return raw;
}
