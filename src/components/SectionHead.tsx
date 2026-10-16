import { H2, MICRO, T } from "@/config/tokens";

/**
 * A section's title with its intro line directly under it, left-aligned, 8px
 * apart, the intro held to 640px (Danny, 16 Oct 2026). It replaces the board's
 * two-column head - title left, intro in the far columns - which left a wide
 * gap between the two on every desktop width.
 *
 * The title's type is the caller's: the home page's display heads are 34px and
 * the guide pages' 28px, and those sizes are the sections' own. Only the
 * arrangement is decided here.
 */
export default function SectionHead({
  title,
  intro,
  micro,
  as: Tag = "h2",
  id,
  className,
  style,
  titleStyle,
  introStyle,
}: {
  title: React.ReactNode;
  intro?: React.ReactNode;
  /** A micro-label above the title, as on the home page's Results. */
  micro?: React.ReactNode;
  as?: "h1" | "h2";
  id?: string;
  /** Extra classes on the title and intro, e.g. `ac-row` for the entrance beat. */
  className?: string;
  style?: React.CSSProperties;
  titleStyle?: React.CSSProperties;
  introStyle?: React.CSSProperties;
}) {
  return (
    <div id={id} className="section-head" style={style}>
      {micro ? <div className={className} style={MICRO}>{micro}</div> : null}
      <Tag className={className} style={{ ...H2, ...(micro ? { marginTop: "8px" } : null), ...titleStyle }}>
        {title}
      </Tag>
      {intro ? (
        <p className={className} style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft, maxWidth: "640px", ...introStyle }}>
          {intro}
        </p>
      ) : null}
    </div>
  );
}
