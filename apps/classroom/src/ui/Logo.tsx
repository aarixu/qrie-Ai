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
 *
 * RISO POP redrew the inks, not the geometry: each orbit is one riso PLATE —
 * the pressable blue and the fluoro pink — overprinted the way a two-colour
 * riso poster actually prints, the nucleus in ink and the electron riding its
 * orbit's fluoro plate (in the icon files, where it sits on amber, the
 * electron gains an ink keyline it does not need in-app). Every
 * colour arrives through a token class and `currentColor`, never a literal
 * hex, so the mark re-pitches itself in the dark room with the rest of the
 * palette (the blue plate lightens, the ink flips to paper) — and it picked up
 * the move from #FFD21E to the marketing site's #FFC85C without a line
 * changing here, which is what the tokens are for. The amber tile and its
 * keyline belong to content/icon.svg — in the app the mark sits straight on
 * whatever surface the screen already has.
 */
export function Logo({
  size = 32,
  className = 'text-primary',
}: {
  /** Rendered edge length in px. The mark is square. */
  size?: number;
  /** Colours the BLUE plate; the pink plate and the ink stay on their tokens. */
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
        <g fill="none" strokeWidth="2.4">
          <ellipse rx="14" ry="6.2" transform="rotate(45)" stroke="currentColor" />
          {/* primary-container IS the fluoro plate — a ground colour, which a
              stroked orbit is: nothing ever has to be read off it. */}
          <ellipse
            rx="14"
            ry="6.2"
            transform="rotate(-45)"
            className="text-primary-container"
            stroke="currentColor"
          />
        </g>
        <circle r="4" className="text-on-background" fill="currentColor" />
        {/* Sits exactly on the far end of the rotate(-45) orbit's major axis,
            and wears that orbit's plate. */}
        <circle
          cx="9.9"
          cy="-9.9"
          r="2.2"
          className="text-primary-container"
          fill="currentColor"
        />
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
