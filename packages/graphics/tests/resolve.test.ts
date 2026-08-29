import { describe, expect, it } from 'vitest';
import { pencilGlyph, resolveNoun, slug, type IconSet } from '../src/resolve';

const set = (prefix: string, names: string[]): IconSet => ({
  prefix,
  width: 128,
  height: 128,
  icons: Object.fromEntries(names.map((n) => [n, { body: `<path d="M0 0"/>` }])),
});

const colour = set('noto', ['boy', 'school', 'house', 'alarm-clock', 'deciduous-tree', 'school-bus']);
const line = set('tabler', ['boy', 'school', 'ruler', 'atom']);

describe('a noun finds its picture', () => {
  it('takes an exact name', () => {
    const r = resolveNoun('school', [colour])!;
    expect(r.source).toEqual({ set: 'noto', icon: 'school' });
    expect(r.how).toBe('exact');
  });

  it('prefers the earlier set when both have the word', () => {
    // Set order is the preference: a friendly colour icon beats a line icon.
    expect(resolveNoun('boy', [colour, line])!.source.set).toBe('noto');
    expect(resolveNoun('boy', [line, colour])!.source.set).toBe('tabler');
  });

  it('reaches through a synonym for a word the sets file differently', () => {
    const r = resolveNoun('home', [colour])!;
    expect(r.source.icon).toBe('house');
    expect(r.how).toBe('synonym');
  });

  it('handles the way narration actually writes a noun', () => {
    for (const written of ['the school', 'Schools', 'A School']) {
      expect(resolveNoun(written, [colour])?.source.icon).toBe('school');
    }
  });

  it('prefers the shortest containing name over a longer one', () => {
    // Otherwise "school" can land on `school-bus`, which is a different thing.
    expect(resolveNoun('school', [set('x', ['school-bus', 'school'])])!.source.icon).toBe(
      'school',
    );
  });

  it('falls back to a prefix match before a contains match', () => {
    const s = set('x', ['pre-clock-thing', 'clock-face']);
    expect(resolveNoun('clock', [s])!.how).toBe('prefix');
  });

  it('returns null when nothing matches, rather than guessing', () => {
    expect(resolveNoun('photosynthesis', [colour, line])).toBeNull();
    expect(resolveNoun('', [colour])).toBeNull();
  });
});

describe('the pencil fallback', () => {
  it('draws something for a noun no set has', () => {
    const g = pencilGlyph('photosynthesis');
    expect(g.body).toContain('<path');
    expect(g.body).toContain('<text');
    expect(g.width).toBe(100);
  });

  it('names the thing, so the board is never a blank circle', () => {
    expect(pencilGlyph('mitosis').body).toContain('mitosis');
  });

  it('is the same shape every time, so one noun is one thing', () => {
    // A placeholder that wobbled differently between beats would read as two
    // different objects.
    expect(pencilGlyph('mitosis').body).toBe(pencilGlyph('mitosis').body);
    expect(pencilGlyph('mitosis').body).not.toBe(pencilGlyph('meiosis').body);
  });

  it('shortens a long name instead of overflowing its circle', () => {
    const g = pencilGlyph('electromagnetic induction');
    expect(g.body).toContain('…');
  });

  it('escapes a name that would break the SVG', () => {
    expect(pencilGlyph('a < b & c').body).not.toMatch(/[^&]<(?!\/?(path|text))/);
    expect(pencilGlyph('a < b & c').body).toContain('&lt;');
  });
});

describe('slug', () => {
  it('makes a stable key out of anything narration throws at it', () => {
    expect(slug('Two Boys Walking!')).toBe('two-boys-walking');
    expect(slug('  spaced  out  ')).toBe('spaced-out');
  });
});
