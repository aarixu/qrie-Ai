import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, type CatalogEntry } from '../lib/content';
import { Screen, EmptyState } from '../ui/Screen';
import { Icon } from '../ui/Icon';

interface Hit {
  kind: 'lesson' | 'topic';
  title: string;
  context: string;
  to: string | null;
}

/**
 * Search across lessons and syllabus topics. Substring matching over a small
 * in-memory catalog is exactly right at this size — an index would be
 * machinery with nothing to do.
 */
export function Search() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];

    const lessons: Hit[] = catalog
      .filter((e) => `${e.title} ${e.subject} ${e.subtitle ?? ''}`.toLowerCase().includes(q))
      .map((e) => ({
        kind: 'lesson',
        title: e.title,
        context: `Class ${e.class} · ${e.subject}`,
        to: `/lesson/${e.id}`,
      }));

    // Topics the syllabus knows about but that have no lesson yet still deserve
    // to be findable — the student learns what is coming.
    const taught = new Set(catalog.map((e) => e.topicRef).filter(Boolean));
    const topics: Hit[] = SYLLABI.flatMap((s) =>
      s.chapters.flatMap((c) =>
        c.topics
          .filter((t) => t.title.toLowerCase().includes(q))
          .filter((t) => !taught.has(`${s.id}/${c.id}/${t.id}`))
          .map<Hit>((t) => ({
            kind: 'topic',
            title: t.title,
            context: `${c.title} · coming soon`,
            to: `/chapter/${s.id}/${c.id}`,
          })),
      ),
    );

    return [...lessons, ...topics];
  }, [query, catalog]);

  return (
    <Screen title="Search">
      <div className="flex items-center gap-2 bg-surface-container-lowest rounded-xl border-2 border-surface-variant px-4 py-3 mb-stack-md focus-within:border-primary transition-colors">
        <Icon name="search" className="text-on-surface-variant" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search lessons and topics"
          aria-label="Search lessons and topics"
          className="flex-1 bg-transparent outline-none font-body-md text-body-md text-on-surface placeholder:text-on-surface-variant"
        />
        {query && (
          <button onClick={() => setQuery('')} aria-label="Clear search" className="text-on-surface-variant">
            <Icon name="close" />
          </button>
        )}
      </div>

      {query.trim().length < 2 ? (
        <EmptyState icon="search" title="What are you looking for?" body="Search by topic, chapter or subject." />
      ) : hits.length === 0 ? (
        <EmptyState icon="search_off" title="Nothing found" body={`No lessons or topics match "${query.trim()}".`} />
      ) : (
        <div className="grid gap-3">
          {hits.map((hit) => (
            <button
              key={`${hit.kind}-${hit.title}`}
              onClick={() => hit.to && navigate(hit.to)}
              className="flex items-center gap-4 text-left bg-surface-container-lowest rounded-[20px] p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div
                className={`w-11 h-11 rounded-full grid place-items-center shrink-0 ${
                  hit.kind === 'lesson' ? 'bg-primary-fixed text-on-primary-fixed' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                <Icon name={hit.kind === 'lesson' ? 'play_arrow' : 'schedule'} filled={hit.kind === 'lesson'} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-headline-md text-[17px] leading-6 text-on-surface truncate">{hit.title}</div>
                <div className="font-label-md text-label-md text-on-surface-variant">{hit.context}</div>
              </div>
              <Icon name="chevron_right" className="text-on-surface-variant" />
            </button>
          ))}
        </div>
      )}
    </Screen>
  );
}
