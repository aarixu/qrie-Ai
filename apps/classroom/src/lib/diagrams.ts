import { useEffect, useState } from 'react';
import type { Lesson } from '@ai-tutor/lesson-format';
import type { CatalogEntry } from './content';

/**
 * Loads the SVG artwork for a lesson's `diagram` elements.
 *
 * `@ai-tutor/stage` makes no network calls by design, so the markup has to be
 * fetched out here and handed to `<Scene assets={…}>`. The lesson already
 * arrives over the network; its artwork arrives the same way, from the same
 * folder.
 *
 * A diagram that fails to load is reported and skipped rather than throwing:
 * a missing picture should cost the class one picture, not the whole class.
 */
export function useDiagramAssets(
  entry: CatalogEntry | null,
  lesson: Lesson | null,
): Record<string, string> {
  const [assets, setAssets] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!entry || !lesson) return;
    const diagrams = lesson.elements.filter((el) => el.kind === 'diagram');
    if (diagrams.length === 0) {
      setAssets({});
      return;
    }

    const folder = entry.path.replace(/\/[^/]+$/, '');
    let cancelled = false;

    (async () => {
      const loaded: Record<string, string> = {};
      await Promise.all(
        diagrams.map(async (el) => {
          const url = `/${folder}/${el.src}`;
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const text = await res.text();
            // A 404 handled by an SPA fallback returns index.html with a 200,
            // which would otherwise be inlined into the canvas as garbage.
            if (!text.trimStart().startsWith('<svg')) {
              throw new Error('response is not an SVG');
            }
            loaded[el.id] = text;
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
