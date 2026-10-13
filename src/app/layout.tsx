import type { Metadata } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Motion from "@/components/Motion";
import SiteChrome from "@/components/SiteChrome";
import { ld, siteGraph } from "@/config/schema";
import { appHref } from "@/lib/app-host";

/**
 * The brand face, self-hosted through next/font rather than the fontsource
 * CSS import it replaces.
 *
 * The import only reached the browser through the app CSS chunk, so the
 * discovery chain was HTML -> CSS -> parse -> woff2, with no preload at any
 * step: the font started downloading after the stylesheet had been read.
 * With font-display: swap that means every cold visit paints in system-ui
 * and reflows when the real face lands - on all 21 pages.
 *
 * next/font emits a preload link for the subset named here, so the woff2 is
 * requested from the HTML instead of after the CSS, and adjustFontFallback
 * (on by default) writes a size-adjust fallback matched to Hanken's metrics,
 * so the swap no longer moves the line boxes.
 *
 * `subsets` names what gets preloaded, not what gets declared: the build
 * still emits all four @font-face blocks - cyrillic-ext, latin-ext,
 * vietnamese and latin - each gated by unicode-range exactly as fontsource
 * had them. So font bytes over the wire are unchanged; a British page
 * fetched only the latin file before and still does. What is new is the
 * preload and the fallback metrics, not a smaller download.
 *
 * This file owns the only <html> in the tree - there is no global-error.tsx -
 * so --font-hanken is always defined where globals.css reads it.
 */
const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-hanken",
});

export const metadata: Metadata = {
  title: {
    default: "alwayscited - Be the brand AI recommends",
    template: "%s | alwayscited",
  },
  description:
    "alwayscited places your brand inside the pages Google and AI systems already trust - so you rank higher, get cited more often, and win buyers before they reach your competitors.",
  metadataBase: new URL("https://alwayscited.com"),
  openGraph: {
    siteName: "alwayscited",
    type: "website",
    locale: "en_GB",
  },
  twitter: {
    card: "summary_large_image",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const htmlClass = "h-full " + hanken.variable;
  return (
    // Motion sets data-motion on this element before first paint, so the
    // server's html and the client's differ by that attribute by the time
    // React looks. suppressHydrationWarning is scoped to this one node and
    // does not reach its children.
    <html lang="en-GB" className={htmlClass} suppressHydrationWarning>
      <body className="min-h-full flex flex-col">
        {/* First in the body: it has to run before the rows below it paint,
            or the page paints settled and then drops back to the from-state. */}
        <Motion />
        {/*
          The one Organization and WebSite node, emitted here so it reaches
          every route - including the ones no page component owns. Every
          author, publisher and provider elsewhere on the site is a bare
          @id reference back to it rather than another copy.
        */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(siteGraph) }} />
        <SiteChrome>
          {/* R151 (1 Oct 2026): keyboard users skip the header's stops - 13
              then, 14 since Log in (13 Oct 2026) - (WCAG 2.2 2.4.1). Hidden
              until focused; .btn-primary's colours, so the stylesheet records
              no new ground. */}
          <a href="#main" className="btn-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:px-4 focus:py-3 focus:text-sm">
            Skip to content
          </a>
          {/* Log in (Danny, 13 Oct 2026): the dashboard's sign-in, on
              whichever host it is on. Read here because the header is a
              client component and APP_HOST does not reach the browser. */}
          <Header loginHref={appHref("/login")} />
        </SiteChrome>
        <main id="main" tabIndex={-1} className="flex-1 outline-none">{children}</main>
        <SiteChrome>
          <Footer />
        </SiteChrome>
      </body>
    </html>
  );
}
