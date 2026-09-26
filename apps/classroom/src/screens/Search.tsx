import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SYLLABI, fetchCatalog, type CatalogEntry } from '../lib/content';
import { useAsync, dataOr } from '../lib/async';
import { Screen, EmptyState } from '../ui/Screen';
import { PROTOTYPE_ONLY_PREPARED } from '../lib/prototype';
import { ErrorState, SkeletonList } from '../ui/States';
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
  const { state, retry } = useAsync(fetchCatalog, []);
  const catalog = dataOr<CatalogEntry[]>(state, []);

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
      ) : state.status === 'loading' ? (
        <SkeletonList rows={3} label="Searching" className="h-[76px]" />
      ) : state.status === 'failed' && hits.length === 0 ? (
        // The syllabus is bundled, so topics are still searchable with no
        // network at all. Nothing matching AND no catalogue is the one case
        // where "Nothing found" would be a lie: we did not finish looking.
        <ErrorState
          title="We could not search your lessons"
          body="The topics below are still searchable, but the lesson list did not load."
          onRetry={retry}
        />
      ) : hits.length === 0 ? (
        /**
         * THE ONE PLACE A STUDENT HAS ALREADY TYPED WHAT THEY WANT.
         *
         * "Nothing found" was a dead end, and it was the wrong answer: the
         * catalogue not having a lesson is a fact about the catalogue, not
         * about whether she can teach it. The same words go to the same room
         * the home screen's Ask box uses — off the syllabus, prepared live.
         */
        /* THE EMPTY STATE PROMISED A CLASS, and while the gate is on it cannot
           keep that promise: the words go to /class?topic=, which has no
           topicRef and is therefore always a live preparation. So the offer is
           withdrawn rather than left as a button that walks to a notice. The
           body says the true thing instead — nothing matched, and this one is
           not written yet. */
        <EmptyState
          icon="search_off"
          title="No lesson on that yet"
          body={
            PROTOTYPE_ONLY_PREPARED
              ? `Nothing in your lessons matches "${query.trim()}". Qrie is still a prototype — a few classes are fully made, and the rest are being written.`
              : `Nothing in your lessons or syllabus matches "${query.trim()}" — but she can still teach it.`
          }
          action={
            PROTOTYPE_ONLY_PREPARED ? undefined : (
              <button
                onClick={() => navigate(`/class?topic=${encodeURIComponent(query.trim())}`)}
                className="mt-1 bg-primary text-on-primary font-label-md text-label-md px-6 py-3 rounded-xl shadow-md border-b-4 border-on-primary-fixed-variant active:border-b-0 active:translate-y-1 transition-all"
              >
                Ask her to teach it
              </button>
            )
          }
        />
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
