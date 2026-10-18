/** The dashboards host's line icons: 16px, 1.6 stroke, currentColor. */
const PATHS: Record<string, string> = {
  overview: "M3 13h4V3H3zM9 13h4V8H9zM9 6h4V3H9z",
  clusters: "M2 4.5h5v3H2zM9 3h5v3H9zM9 8.5h5v4.5H9zM2 10h5v3H2z",
  ai: "M8 1.8l1.6 3.9 3.9 1.6-3.9 1.6L8 12.8 6.4 8.9 2.5 7.3l3.9-1.6z",
  google: "M2 12l3.5-4 3 2.5L14 4M10 4h4v4",
  sources: "M6.5 9.5l3-3M5 7.5L3.6 8.9a2.5 2.5 0 003.5 3.5L8.5 11M11 8.5l1.4-1.4a2.5 2.5 0 00-3.5-3.5L7.5 5",
  opportunities: "M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2",
  integrations: "M6 2v3M10 2v3M4.5 5h7v3a3.5 3.5 0 01-7 0zM8 11.5V14",
  plan: "M3 2.5h10v11H3zM5.5 5.5h5M5.5 8h5M5.5 10.5h3",
  plus: "M8 3v10M3 8h10",
  x: "M4 4l8 8M12 4l-8 8",
  edit: "M10.5 3l2.5 2.5L6 12.5H3.5V10z",
  more: "M3.5 8h.01M8 8h.01M12.5 8h.01",
  grip: "M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01",
  move: "M3 8h10M10 5l3 3-3 3",
  undo: "M5 6.5L2.5 4 5 1.5M2.5 4H10a3.5 3.5 0 010 7H6",
  check: "M3 8.5l3 3 7-7",
  arrow: "M3 8h10M9.5 4.5L13 8l-3.5 3.5",
  ext: "M9 3h4v4M13 3L7.5 8.5M11 9.5V13H3V5h3.5",
  lock: "M4.5 7V5a3.5 3.5 0 017 0v2M3.5 7h9v6.5h-9z",
  settings: "M2.5 4.5h7M12 4.5h1.5M2.5 11.5h2M7 11.5h6.5M9.5 3v3M4.5 10v3",
};

export default function Icon({ name, size = 16, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }) {
  const d = PATHS[name] ?? PATHS.more!;
  const dots = name === "more" || name === "grip";
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={dots ? 2.6 : 1.6} strokeLinecap="round" strokeLinejoin="round" role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={d} />
    </svg>
  );
}
