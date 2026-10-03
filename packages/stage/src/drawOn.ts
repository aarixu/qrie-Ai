/**
 * A DRAWING THAT IS DRAWN. Every shape in a diagram or an icon gets
 * `pathLength="1"` and the board's ink classes, so its stroke travels on
 * and its fill follows (Scene's `.stage-ink`, `.stage-ink-fill`).
 *
 * Applied to the markup at render time only; the artwork as stored and
 * reviewed is untouched. Left alone, because drawing them on would spoil
 * them:
 *   - a shape with its own dash pattern (a dashed line would end solid);
 *   - a shape with one of the painter's motions (`curie-…`), whose own
 *     animation the ink class would replace;
 *   - a shape that sets pathLength already.
 * A shape with its own fill-opacity is drawn on but its fill is not faded in,
 * because the fade would end at full opacity and override it.
 *
 * Safety: this writes only constant text (two class names, `pathLength="1"`)
 * into markup that has already passed the relay's `unsafeMarkup` gate, which
 * refuses scripts, handlers, embeds and external references ANYWHERE in the
 * string, quoted or not — so even an odd `class="` inside another value,
 * re-quoted by this, cannot bring a refused thing into play.
 */

export const DRAW_ON_LIMIT = 400;

const SHAPE = /<(path|line|polyline|polygon|circle|ellipse|rect)\b([^>]*?)(\/?)>/gi;
const SPOILS = /stroke-dasharray|pathLength|curie-/i;

/** The markup with every shape marked to be drawn on, or null when it has too many shapes for a phone. */
export function drawOnMarkup(markup: string): string | null {
  const count = markup.match(SHAPE)?.length ?? 0;
  if (count === 0 || count > DRAW_ON_LIMIT) return null;
  return markup.replace(SHAPE, (whole, tag: string, attrs: string, selfClose: string) => {
    if (SPOILS.test(attrs)) return whole;
    const ink = /fill-opacity/i.test(attrs) ? 'stage-ink' : 'stage-ink stage-ink-fill';
    const classed = /\bclass\s*=\s*"/i.test(attrs)
      ? attrs.replace(/\bclass\s*=\s*"/i, `class="${ink} `)
      : `${attrs} class="${ink}"`;
    return `<${tag}${classed} pathLength="1"${selfClose}>`;
  });
}
