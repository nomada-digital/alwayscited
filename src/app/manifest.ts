import type { MetadataRoute } from "next";

/**
 * The web app manifest (18 Oct 2026 brief, 2f): the purple asterisk at 192 and
 * 512, the same mark as icon.svg, favicon.ico and apple-icon.png. Served on
 * every host - app-host.ts PASS_THROUGH and dash/host.ts PASS both let
 * /manifest and /icon* through untouched.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "alwayscited",
    short_name: "alwayscited",
    description: "Who the AI engines name for your keyword clusters, and the work that gets you named.",
    start_url: "/",
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#7C3AED",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
