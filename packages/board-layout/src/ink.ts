import { INK_NAMES, type Element, type InkName } from '@ai-tutor/lesson-format';

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * WHICH COLOUR EACH NAMED PART GETS (board composer, 2026-10-03).
 *
 * In the order the parts are first named, round the palette. A part is found
 * by its own name and by the words of its label, so "Lacteal" in the notes
 * matches the label "Lacteal" whatever the part is called inside the picture.
 */
export function inksFor(named: readonly { part: string; text: string }[]): (key: string) => InkName | undefined {
  const byKey = new Map<string, InkName>();
  let next = 0;
  for (const { part, text } of named) {
    let ink = byKey.get(norm(part));
    if (!ink) {
      ink = INK_NAMES[next % INK_NAMES.length];
      next += 1;
      byKey.set(norm(part), ink);
    }
    if (!byKey.has(norm(text))) byKey.set(norm(text), ink);
  }
  return (key) => byKey.get(norm(key));
}

/**
 * Colour a page. Each name, line and mark is coloured by the part it belongs
 * to (`partOf`: element id -> part), and each notes item by its term. Anything
 * else is returned as it came, the same object.
 */
export function paintInks(
  elements: readonly Element[],
  inkOf: (key: string) => InkName | undefined,
  partOf: ReadonlyMap<string, string>,
): Element[] {
  return elements.map((el) => {
    const part = partOf.get(el.id);
    if (part !== undefined && (el.kind === 'handwrite' || el.kind === 'arrow' || el.kind === 'mark')) {
      const ink = inkOf(part);
      return ink ? { ...el, ink } : el;
    }
    if (el.kind === 'list') {
      let changed = false;
      const items = el.items.map((it) => {
        const ink = inkOf(it.term);
        if (!ink) return it;
        changed = true;
        return { ...it, ink };
      });
      return changed ? { ...el, items } : el;
    }
    return el;
  });
}
