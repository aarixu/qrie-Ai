import { useEffect, useState } from 'react';
import type { Element, Lesson } from '@ai-tutor/lesson-format';
import type { CatalogEntry } from './content';

/**
 * The artwork a lesson needs INLINED into the page.
 *
 * `@ai-tutor/stage` makes no network calls by design, so markup has to be
 * fetched out here and handed to `<Scene assets={…}>`. It is markup rather
 * than an image URL for one reason: a diagram inlined into the page has a
 * `<g id="cortex">` the tutor can light up from inside, and an `<img>` does
 * not.
 *
 * Two shapes arrive here, and the difference is where the class came from:
 *
 *   - A class SAVED from a live prep keeps every piece of inline markup in one
 *     `assets.json`, keyed by element id. It has to: a `graphic` — the little
 *     picture for a noun — has no `src` of its own to name a file after, so a
 *     per-file convention would silently lose every one of them.
 *   - The hand-authored lessons predate that and keep one SVG file per
 *     diagram, named by the element's `src`.
 *
 * A picture is neither: it is a real image file the renderer loads by URL, and
 * a saved class already points at it absolutely. Nothing to do here.
 *
 * Artwork that fails to load is reported and skipped rather than thrown: a
 * missing picture should cost the class one picture, not the whole class.
 */
export function useLessonAssets(
  entry: CatalogEntry | null,
  lesson: Lesson | null,
): Record<string, string> {
  const [assets, setAssets] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!entry || !lesson) return;
    const diagrams = lesson.elements.filter((el) => el.kind === 'diagram');
    const inlined = lesson.elements.some((el) => el.kind === 'graphic') || diagrams.length > 0;
    if (!inlined) {
      setAssets({});
      return;
    }

    /**
     * The folder the lesson's artwork sits in, beside its lesson.json.
     *
     * An authored lesson's path is relative to the static root; a class kept
     * in Storage carries a whole URL. Prefixing the second with a slash would
     * ask this origin for "/https://…", which 404s into the SPA fallback and
     * arrives as index.html.
     */
    const base = entry.path.replace(/\/[^/]+$/, '');
    const folder = /^https?:\/\//.test(base) ? base : `/${base}`;
    let cancelled = false;

    const svgOrThrow = async (url: string): Promise<string> => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // A 404 handled by an SPA fallback returns index.html with a 200, which
      // would otherwise be inlined into the canvas as garbage.
      if (!text.trimStart().startsWith('<svg')) throw new Error('response is not an SVG');
      return text;
    };

    (async () => {
      const bundled = await fetch(`${folder}/assets.json`)
        .then((res) => (res.ok ? (res.json() as Promise<Record<string, string>>) : null))
        .catch(() => null);
      if (bundled) {
        if (!cancelled) setAssets(bundled);
        return;
      }

      const loaded: Record<string, string> = {};
      await Promise.all(
        diagrams.map(async (el) => {
          const url = `${folder}/${(el as Extract<Element, { kind: 'diagram' }>).src}`;
          try {
            loaded[el.id] = await svgOrThrow(url);
          } catch (e) {
            console.error(`[diagram] "${el.id}" could not load ${url}:`, e);
          }
        }),
      );
      if (!cancelled) setAssets(loaded);
    })();

    return () => {
      cancelled = true;
    };
  }, [entry, lesson]);

  return assets;
}
