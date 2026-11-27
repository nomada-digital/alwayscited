-- "Prompts for your site" (Danny, 26 Nov 2026): ready-to-paste Claude/AI prompts we publish to a customer's dashboard,
-- instead of putting them in an email. One row per deliverable: a title, an intro, and its prompts as
-- [{title, body}]. Staff publish from the hub through /api/hub/agency prompts_publish (lib/agency/prompts.ts); the
-- customer's dashboard shows published rows only, at /<slug>/prompts. Additive: one new table. Service-role only (RLS on,
-- no policies), authorisation in the app, as every other table here.
create table if not exists public.client_prompt_deliverables (
  id               uuid primary key default gen_random_uuid(),
  client_domain_id uuid not null references public.client_domains(id) on delete cascade,
  title            text not null check (char_length(title) between 3 and 200),
  intro            text check (intro is null or char_length(intro) <= 2000),
  prompts          jsonb not null default '[]'::jsonb check (jsonb_typeof(prompts) = 'array' and jsonb_array_length(prompts) <= 40 and pg_column_size(prompts) <= 262144),
  status           text not null default 'draft' check (status in ('draft','published')),
  published_at     timestamptz,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists client_prompt_deliverables_client_idx on public.client_prompt_deliverables (client_domain_id, status, published_at desc);
alter table public.client_prompt_deliverables enable row level security;

-- MOR Talent Boutique: the two prompts from the hub's ready email dee92766-4fda-4210-9640-e3f8a7978975 (its two <pre>
-- blocks, verbatim). Fixed id so the seed is idempotent.
insert into public.client_prompt_deliverables (id, client_domain_id, title, intro, prompts, status, published_at, created_by)
select '5b0c2f1e-7a4d-4c1e-9a52-3d8f6e1a2b01'::uuid, c.id,
  'Household staff agency: homepage + internal links',
  $i$Your homepage and your household staff page are both going after "household staff agency", so Google has to pick one and the links we are building get split between them. The fix is to make the homepage about MOR as a whole and keep the household staff page as the only one for that search, with the homepage linking across to it. Paste these into your Claude project: do prompt 1 first, then prompt 2. Both only touch the bits listed and leave everything else as it is.$i$,
  jsonb_build_array(
    jsonb_build_object('title', 'Prompt 1: homepage', 'body', $p1$I want to stop my homepage competing with my household staff page in Google. The household staff page (https://www.mortalentboutique.com/household-staff) should be the only page on the site targeting the phrase "household staff agency". The homepage should be about MOR Talent Boutique as a whole - boutique private staff recruitment for UHNW households and family offices.

Only change the homepage (/). Keep the design, layout, images, sections, links and all other copy exactly as they are. Only make the changes below.

1. Page title (the title tag and og:title)
Change to: MOR Talent Boutique | Private Staff Recruitment for UHNW Homes

2. Meta description (meta description and og:description)
Change to: Boutique private staff recruitment for UHNW families and family offices, run personally by Michael O'Riordan across the UK, the US, Europe and the Gulf.

3. H1
Change "Senior household staff for UHNW homes" to: Boutique private staff recruitment for UHNW homes

4. Small label above the H1
Change "Household staff agency · London · UK · US" to: Founder-led · London · UK · US

5. H2s - change these two only
"The household staff we place" becomes: Household and private office roles we fill
"Household staff agency FAQs" becomes: Working with MOR: FAQs

6. Small label above "The household staff we place"
Change "Household staff agency" to: What we recruit

7. FAQ question
Change "How much does a household staff agency charge?" to: How do your fees work?
Keep the answer as it is. If the FAQs are also in structured data (FAQPage schema) update the question there to match.

8. The "Household staff agency" line just under the header
If this line only shows on the homepage change it to: Private staff recruitment
If it comes from a shared header used on every page, change it on the homepage only and leave the other pages as they are.

9. Keep the link to the household staff page
In the "You run the household. We find the people." section keep the sentence starting "MOR Talent Boutique is a household staff agency for the teams behind a principal" exactly as it is, with "household staff agency" still linked to https://www.mortalentboutique.com/household-staff. This is now the only place the homepage uses that phrase, and the link is what passes relevance to the household staff page - don't remove it. Keep the "All household staff →" link to the same page too.

Don't change any other page, the URL, the canonical, the footer or any other structured data. When you're done list every change you made.$p1$),
    jsonb_build_object('title', 'Prompt 2: internal links', 'body', $p2$Add internal links to my household staff agency page so Google sees it as the main page for "household staff agency".

Every link below points to: https://www.mortalentboutique.com/household-staff
Every link uses the same clickable words: household staff agency

Rules
- Make only the edits listed. Each one swaps an existing sentence for a new version that includes "household staff agency" - link those three words and nothing else.
- Use normal in-text links, styled like the other links in the body. No nofollow.
- If you can't find a sentence exactly as written (punctuation or dashes may differ slightly), use the closest match on that page and tell me which one you used. If there's no close match, skip it and tell me.
- Don't change the navigation, footer, page titles, H1s, the shared end-of-post or end-of-case-study boxes, or anything else.

BLOG POSTS

1. /blog/the-hidden-cost-of-overqualification-in-private-service
Find: "contact MOR Talent Boutique through our Client Services page."
Replace with: "contact MOR Talent Boutique through our household staff agency page."

2. /blog/luxury-household-staffing-trends-for-2026
Find: "Principals who treat their household staff as long-term strategic hires consistently outperform those who cycle through talent reactively."
Replace with: "Principals who treat their household staff as long-term strategic hires, and work with a specialist household staff agency to find them, consistently outperform those who cycle through talent reactively."

3. /blog/why-household-hires-should-start-with-a-trial
Find: "If you are planning a hire for your household or family office, I would be happy to talk through how I would approach it."
Replace with: "If you are planning a hire for your household or family office, I would be happy to talk through how our household staff agency would approach it."

4. /blog/how-to-identify-and-avoid-scammers-in-recruitment
Find: "Household staffing is especially exposed."
Replace with: "Household staffing is especially exposed, which is why it pays to use an established household staff agency."

5. /blog/5-proven-ways-to-optimise-staff-retention-in-private-households
Find: "Retaining high-performing private staff is one of the most consistent challenges in UHNW households."
Replace with: "Retaining high-performing private staff is one of the most consistent challenges in UHNW households, and one we see every week as a household staff agency."
Also delete this leftover drafting note from the post: (We will later link to your dedicated "How to Professionalise Your Onboarding" blog.)

6. /blog/why-recruitment-deposits-improve-hiring-outcomes-for-everyone
Find: "When you run a small, specialist agency, you have to be selective."
Replace with: "When you run a small, specialist household staff agency, you have to be selective."

7. /blog/building-a-stable-and-respectful-working-culture-in-private-households
Find: "Private staff are professionals."
Replace with: "Private staff are professionals, and any good household staff agency will tell you they expect to be treated that way."

8. /blog/how-to-professionalise-your-onboarding-in-private-households
Find: "Onboarding is the single most underrated retention tool in private service."
Replace with: "Onboarding is the single most underrated retention tool in private service - and the one part of a hire a household staff agency can't do for you."

9. /blog/building-high-performance-teams-in-the-gcc
Find: "The instinct for many principals is to rush into hiring housekeepers or chefs."
Replace with: "The instinct for many principals is to rush into hiring housekeepers or chefs, often through the first household staff agency they find."

CASE STUDIES

10. /case-studies/stabilising-private-office-culture-not-just-hiring
Find: "The client needed senior household staff who could bring structure, reliability, and calm to a fast-paced environment."
Replace with: "The client came to our household staff agency needing senior household staff who could bring structure, reliability, and calm to a fast-paced environment."

11. /case-studies/high-calibre-household-team-qatar
Find: "When household teams must be built quickly, most agencies will promise speed — but only a few can deliver it without cutting corners."
Replace with: "When household teams must be built quickly, most agencies will promise speed — but only a household staff agency with a deep private network can deliver it without cutting corners."

12. /case-studies/residence-manager-uhnw-family-riyadh
Find: "Since she started, we have also placed several of the general staff for the principal, and the family has referred friends to us."
Replace with: "Since she started, our household staff agency has also placed several of the general staff for the principal, and the family has referred friends to us."

13. /case-studies/travelling-butler-global-uhnw-family
Find: "I have since placed staff across the family's global portfolio of homes."
Replace with: "I have since placed staff across the family's global portfolio of homes through our household staff agency."

14. /case-studies/restoring-trust-childcare-hiring-global-uhnw-family
Find: "Specialist agencies create long-term security."
Replace with: "A specialist household staff agency creates long-term security."

OTHER PAGES

15. /blog (the blog home page)
Find: "Thought leadership and practical advice for building and leading exceptional private service teams."
Replace with: "Thought leadership and practical advice from our household staff agency for building and leading exceptional private service teams."

16. /vacancies - the "Looking for staff?" section
Find: "Send a brief and Michael will come back to you within one working day."
Replace with: "Send a brief and Michael will come back to you within one working day, or read how our household staff agency works first."

When you're done list each page you changed, the new sentence and confirm the link goes to https://www.mortalentboutique.com/household-staff.$p2$)
  ),
  'published', now(), 'seed 20261126000000'
from public.client_domains c
where c.slug = 'mortalentboutique-com'
on conflict (id) do nothing;
