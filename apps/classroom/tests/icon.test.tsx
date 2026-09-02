import { readdirSync, readFileSync } from 'node:fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Icon } from '../src/ui/Icon';

/**
 * EVERY NAME THE APP ASKS FOR MUST DRAW SOMETHING.
 *
 * The icon set moved from Material Symbols to Lucide behind this one
 * component, and the call sites kept their Material spellings on purpose.
 * That trade is only safe if the map is complete — so this reads the source
 * and checks every name the app actually uses, rather than a list somebody
 * remembered to update.
 */

/**
 * Every file that could name an icon — including lib, where the achievement
 * and subject tables live. Reading only screens and ui is exactly how five
 * names shipped as bullet points.
 */
const sources = ['src/screens', 'src/ui', 'src/lib'].flatMap((dir) =>
  readdirSync(`apps/classroom/${dir}`)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => readFileSync(`apps/classroom/${dir}/${f}`, 'utf8')),
);

/**
 * Every literal that reaches Icon: as a prop, and as data in a table.
 *
 * The `icon="…"` form is here because it was NOT, and that is precisely how
 * three empty states — the placement test's "not mapped yet", the search's
 * "nothing found", the study plan's "building your plan" — shipped drawing a
 * bullet point. Every component in this app that forwards a name to Icon
 * spells the prop `icon`, so it is the commonest spelling of all.
 */
const namesUsed = (): string[] => {
  const found = new Set<string>();
  for (const src of sources) {
    // name="x" and icon="x", on any component that forwards to Icon.
    for (const m of src.matchAll(/\b(?:name|icon)="([a-z_0-9]{3,})"/g)) found.add(m[1]);
    // name={cond ? 'a' : 'b'} and icon={…'a'…}
    for (const m of src.matchAll(/\b(?:name|icon)=\{[^}]*?'([a-z_0-9]{3,})'/g)) found.add(m[1]);
    // { icon: 'x' } in the achievement and subject tables
    for (const m of src.matchAll(/\bicon:\s*'([a-z_0-9]{3,})'/g)) found.add(m[1]);
    for (const m of src.matchAll(/\brow\(\s*'([a-z_0-9]{3,})'/g)) found.add(m[1]);
  }
  return [...found];
};

describe('the icon map', () => {
  it('draws something for every name the app uses', () => {
    const missing = namesUsed().filter(
      (name) => renderToString(<Icon name={name} />) === '<span aria-hidden="true">•</span>',
    );
    expect(missing, `no glyph for: ${missing.join(', ')}`).toEqual([]);
  });

  it('found a real set of names to check, not an empty one', () => {
    expect(namesUsed().length).toBeGreaterThan(25);
  });

  it('reads the icon="…" prop form, which is how most empty states name theirs', () => {
    // Guarding the guard: this extraction missed that form once, and the only
    // symptom was a grey dot on screens nobody had a test for.
    expect(namesUsed()).toContain('explore_off');
    expect(namesUsed()).toContain('search_off');
  });

  it('renders an svg, not a webfont span', () => {
    const html = renderToString(<Icon name="play_arrow" />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('material-symbols');
  });

  it('inherits its size from the text around it, as the old span did', () => {
    expect(renderToString(<Icon name="check" />)).toContain('1em');
  });

  it('shows a dot rather than throwing when a name has no glyph', () => {
    expect(() => renderToString(<Icon name="not_a_real_icon" />)).not.toThrow();
    expect(renderToString(<Icon name="not_a_real_icon" />)).toContain('•');
  });
});
