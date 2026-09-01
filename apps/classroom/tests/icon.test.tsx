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

/** Every literal that reaches Icon: as a prop, and as data in a table. */
const namesUsed = (): string[] => {
  const found = new Set<string>();
  for (const src of sources) {
    for (const m of src.matchAll(/<Icon[^>]*\sname="([a-z_]+)"/g)) found.add(m[1]);
    for (const m of src.matchAll(/name=\{[^}]*?'([a-z_]{3,})'/g)) found.add(m[1]);
    for (const m of src.matchAll(/\bicon:\s*'([a-z_]{3,})'/g)) found.add(m[1]);
    for (const m of src.matchAll(/\brow\(\s*'([a-z_]{3,})'/g)) found.add(m[1]);
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
