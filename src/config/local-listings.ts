/**
 * Local listings (Danny, 17 Nov 2026): for a local business, the directories its name, area, phone and website should
 * sit on, the same everywhere, as a checklist the customer works through - with a note that we do it as a service.
 * Per customer, by dashboard slug: a customer with no entry has no Local listings section. Prices are never shown,
 * only whether a listing is free or paid.
 *
 * Each item's `status` is where it stood when the list was written (Listed, Not listed, or Check - listed, but
 * something on it needs putting right); the customer ticks items off on the page (lib/dash/listings.ts). Each link
 * is the directory's own page for adding or managing a business, checked on 17 Nov 2026.
 */
export type ListingStatus = "listed" | "not_listed" | "check";
export type ListingItem = { key: string; name: string; action: string; status: ListingStatus; cost: "free" | "paid" | "free_or_paid"; links: { label: string; url: string }[] };
export type LocalListings = {
  /** The map area named in the intro, e.g. "Leeds". */
  area: string;
  details: { name: string; location: string; phone: string; website: string; category: string; serves: string };
  items: ListingItem[];
  /** Who to reply to for us to do it. */
  contact: string;
};

const ALISTAIR: LocalListings = {
  // Source: the GBP and local citation audit of 16 Nov 2026, section 6 (plan) and section 5 (where each stood).
  area: "Leeds",
  details: {
    name: "Alistair Mac Photography",
    location: "Leeds",
    phone: "07988 416417",
    website: "https://www.alistairmacphotography.com/",
    category: "Wedding photographer",
    serves: "Leeds, Yorkshire and the North of England",
  },
  items: [
    { key: "website", name: "Website business details (Wix)", action: "Fix the Manchester address so it matches the details above.", status: "check", cost: "free", links: [{ label: "Wix", url: "https://manage.wix.com/" }] },
    { key: "bing", name: "Bing Places", action: "Create your listing by importing it from your Google Business Profile.", status: "not_listed", cost: "free", links: [{ label: "Bing Places", url: "https://www.bingplaces.com/" }] },
    { key: "apple", name: "Apple Business Connect", action: "Create and verify your listing, then add photos, hours and your category.", status: "not_listed", cost: "free", links: [{ label: "Apple Business Connect", url: "https://businessconnect.apple.com/" }] },
    { key: "facebook", name: "Facebook page", action: "Change your base to Leeds, and add your phone, website and category.", status: "check", cost: "free", links: [{ label: "Facebook", url: "https://www.facebook.com/pages/?category=your_pages" }] },
    { key: "hitched", name: "Hitched", action: "Check your name, Leeds, phone and website link, and refresh your photos and description.", status: "check", cost: "free_or_paid", links: [{ label: "Hitched", url: "https://www.hitched.co.uk/business-login/" }] },
    { key: "yelp", name: "Yelp UK", action: "Create your business page. Apple Maps also uses Yelp's details.", status: "not_listed", cost: "free", links: [{ label: "Yelp for Business", url: "https://business.yelp.com/" }] },
    { key: "yell", name: "Yell", action: "Create a free listing.", status: "not_listed", cost: "free", links: [{ label: "Yell", url: "https://www.yell.com/free-listing/" }] },
    { key: "bridebook", name: "Bridebook", action: "Create a supplier profile with Leeds as your base.", status: "not_listed", cost: "free", links: [{ label: "Bridebook", url: "https://partners.bridebook.com/uk" }] },
    { key: "guidesforbrides", name: "Guides for Brides", action: "Create a listing under West Yorkshire, Leeds.", status: "not_listed", cost: "free", links: [{ label: "Guides for Brides", url: "https://www.guidesforbrides.co.uk/" }] },
    { key: "thomsonlocal", name: "Thomson Local", action: "Create a free listing.", status: "not_listed", cost: "free", links: [{ label: "Thomson Local", url: "https://www.bluecatdigital.co.uk/listings" }] },
    { key: "freeindex", name: "FreeIndex", action: "Create a listing.", status: "not_listed", cost: "free", links: [{ label: "FreeIndex", url: "https://www.freeindex.co.uk/signup.htm" }] },
    {
      key: "profiles",
      name: "WedFrame, This Is Reportage, PKIR, Instagram, TikTok",
      action: "Lead with Leeds, use the same details, and link to your homepage.",
      status: "check",
      cost: "free",
      links: [
        { label: "WedFrame", url: "https://wedframe.com/" },
        { label: "This Is Reportage", url: "https://thisisreportage.com/register/" },
        { label: "PKIR", url: "https://www.photographerskeepingitreal.com/register/" },
        { label: "Instagram", url: "https://www.instagram.com/accounts/edit/" },
        { label: "TikTok", url: "https://www.tiktok.com/" },
      ],
    },
    {
      key: "wedding-basics",
      name: "Confetti, UKbride, Add to Event",
      action: "Create a basic supplier listing on each.",
      status: "not_listed",
      cost: "free",
      links: [
        { label: "Confetti", url: "https://www.confetti.co.uk/advertise/" },
        { label: "UKbride", url: "https://www.wedhub.co.uk/advertise/suppliers" },
        { label: "Add to Event", url: "https://www.addtoevent.co.uk/join" },
      ],
    },
    {
      key: "editorial",
      name: "Optional: Rock My Wedding or Love My Dress directory",
      action: "A strong fit for your documentary style, with good links back to your site.",
      status: "not_listed",
      cost: "paid",
      links: [
        { label: "Rock My Wedding", url: "https://www.rockmywedding.co.uk/supplier-pricing" },
        { label: "Love My Dress", url: "https://www.lovemydress.net/advertising" },
      ],
    },
    {
      key: "regional",
      name: "Optional: a Yorkshire wedding directory",
      action: "One regional listing, such as a Yorkshire wedding directory or the West and North Yorkshire Chamber.",
      status: "check",
      cost: "paid",
      links: [{ label: "West and North Yorkshire Chamber", url: "https://www.wnychamber.co.uk/membership/" }],
    },
  ],
  contact: "Kev",
};

export const LOCAL_LISTINGS: Record<string, LocalListings> = {
  "alistairmacphotography-com": ALISTAIR,
};

export function localListingsFor(slug: string): LocalListings | null {
  return LOCAL_LISTINGS[slug] ?? null;
}
