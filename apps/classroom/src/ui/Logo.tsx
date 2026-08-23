import { BRAND } from '../brand';

/**
 * The mark: a nucleus circled by two crossed orbits, with one electron caught
 * at the top of its arc.
 *
 * The app is named for Marie Curie, so the mark points at her subject — the
 * atom — instead of the lightbulb every other learning app reaches for. It is
 * inline SVG rather than an image file for two reasons: it inherits its colour
 * from a Tailwind text class via `currentColor`, so it themes with the rest of
 * the app, and it stays crisp at every size without a second asset.
 *
 * Geometry sits in a 32-unit box centred on the origin. The orbits are one
 * ellipse mirrored across the vertical at ±45°, which is the angle that makes
 * the silhouette square — so the mark optically centres inside a circle or a
 * rounded square without nudging. Stroke weight is tuned so the orbits still
 * read as two distinct rings at 24px.
 */
export function Logo({
  size = 32,
  className = 'text-primary',
}: {
  /** Rendered edge length in px. The mark is square. */
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g transform="translate(16 16)">
        <g fill="none" stroke="currentColor" strokeWidth="2.4">
          <ellipse rx="14" ry="6.2" transform="rotate(45)" />
          <ellipse rx="14" ry="6.2" transform="rotate(-45)" />
        </g>
        <circle r="4" fill="currentColor" />
        {/* Sits exactly on the far end of the rotate(-45) orbit's major axis. */}
        <circle cx="9.9" cy="-9.9" r="2.2" fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * The full lockup: the mark above the product name.
 *
 * Stacked rather than side-by-side because every surface that needs the lockup
 * is a centred, held moment — the splash today, an install or share card later.
 * The name is read from BRAND so a rename never has to touch a component.
 */
export function Wordmark({
  className = '',
  size = 40,
}: {
  className?: string;
  /** Size of the mark; the name keeps its headline scale. */
  size?: number;
}) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`.trim()}>
      <Logo size={size} />
      <span className="font-headline-lg text-headline-lg text-primary">{BRAND.name}</span>
    </div>
  );
}
