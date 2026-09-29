import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * THE GATE IS OFF IN THE APP SINCE 2026-09-29 (Aarav: full tutor first). These
 * tests keep proving what it does when it is turned back on, so they turn it on
 * here — the constant and the one helper that reads it inside the module.
 */
vi.mock('../src/lib/prototype', async (real) => ({
  ...(await real<typeof import('../src/lib/prototype')>()),
  PROTOTYPE_ONLY_PREPARED: true,
  isFrozen: (r: string) => r === 'not-yet',
}));
import { Chapter } from '../src/screens/Chapter';
import { AskBox } from '../src/ui/AskBox';
import { LiveClassRoute } from '../src/screens/LiveClass';
import { Search } from '../src/screens/Search';
import { SYLLABI, forgetCatalog } from '../src/lib/content';
import { PROTOTYPE_ONLY_PREPARED, PROTOTYPE_NOTICE } from '../src/lib/prototype';

/**
 * ONLY A CLASS THAT EXISTS MAY BE OPENED.
 *
 * Google Cloud billing is off on the project the relay calls, so a topic with
 * no prepared class cannot be prepared: preparation starts and dies. Before
 * this gate, tapping any Mathematics topic showed a child the vendor's own
 * words — "enable billing on project #project-dd876d44-…" and a Google console
 * URL — which is both unreadable to them and a disclosure of a cloud project
 * id to anyone who tapped.
 *
 * WHAT THESE TESTS ARE FOR, in order of what it costs to get wrong:
 *
 *   1. THE ROUTE, NOT THE TILE, IS THE GATE THAT COUNTS. A tile is one door;
 *      /class/* is reachable by a typed URL, a pasted link, a bookmark and the
 *      back button, and by two query forms that carry no topicRef at all. A
 *      gate on the buttons alone leaves every one of those open.
 *   2. A WARM TOPIC MUST STILL OPEN. A gate that froze everything would be a
 *      broken app rather than a prototype.
 *   3. THE FROZEN TILE MUST STILL ANSWER. aria-disabled and not disabled: a
 *      disabled button takes no click, so it would swallow the tap and read as
 *      broken instead of as not-ready.
 */

const roots: Root[] = [];

/** Class 10 Mathematics — nothing in this app has ever prepared one of these. */
const MATHS = SYLLABI.find((s) => s.klass === 10 && s.subject === 'Mathematics')!;
const COLD_CHAPTER = MATHS.chapters[0];

const respond = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

/** A catalogue holding exactly one warm topic, the first of the cold chapter. */
const WARM_REF = `${MATHS.id}/${COLD_CHAPTER.id}/${COLD_CHAPTER.topics[0].id}`;
const WARM_ENTRY = {
  id: 'warm-one',
  title: COLD_CHAPTER.topics[0].title,
  subtitle: 'Class 10 · Mathematics',
  class: 10,
  subject: 'Mathematics',
  path: 'warm-one/lesson.json',
  topicRef: WARM_REF,
};

let catalogue: unknown[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  forgetCatalog();
  catalogue = [];
  vi.stubGlobal('fetch', (url: string) =>
    String(url).includes('index.json')
      ? Promise.resolve(respond({ lessons: catalogue }))
      : Promise.resolve(respond({ states: {} })),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

async function settle(turns = 5): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function mount(node: React.ReactNode): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(node));
  return host;
}

async function openChapter(): Promise<HTMLElement> {
  const host = mount(
    <MemoryRouter initialEntries={[`/chapter/${MATHS.id}/${COLD_CHAPTER.id}`]}>
      <Routes>
        <Route path="/chapter/:syllabusId/:chapterId" element={<Chapter />} />
      </Routes>
    </MemoryRouter>,
  );
  await settle();
  return host;
}

/** Every topic tile on the chapter screen. */
const tilesIn = (host: HTMLElement): HTMLButtonElement[] =>
  [...host.querySelectorAll('button')].filter((b) => b.textContent?.includes('Topic '));

describe('the gate is on', () => {
  it('is on, which every assertion below depends on', () => {
    expect(PROTOTYPE_ONLY_PREPARED).toBe(true);
  });
});

describe('a topic with no class does not invite a tap', () => {
  it('drops the words that sent a child into the failure', async () => {
    const host = await openChapter();
    // "Start this class" on a tile that cannot start one is the sentence this
    // whole change exists to remove.
    expect(host.textContent).not.toContain('Start this class');
    expect(host.textContent).toContain('Coming soon');
  });

  it('marks the tile aria-disabled rather than disabled, so the tap still lands', async () => {
    const host = await openChapter();
    const tile = tilesIn(host)[0];
    expect(tile.getAttribute('aria-disabled')).toBe('true');
    // The distinction that matters: a `disabled` button fires no click, so the
    // student would tap a dimmed tile and get nothing at all.
    expect(tile.disabled).toBe(false);
  });

  it('answers the tap with the notice, naming the topic they reached for', async () => {
    const host = await openChapter();
    await act(async () => {
      tilesIn(host)[0].click();
    });
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog, 'no notice opened').not.toBeNull();
    expect(dialog!.textContent).toContain(COLD_CHAPTER.topics[0].title);
    expect(dialog!.textContent).toContain(PROTOTYPE_NOTICE.title);
  });
});

describe('a topic that HAS a class is untouched', () => {
  it('keeps its invitation and stays tappable', async () => {
    catalogue = [WARM_ENTRY];
    const host = await openChapter();
    const tile = tilesIn(host)[0];
    expect(tile.getAttribute('aria-disabled')).not.toBe('true');
    // A warm tile never carried "Start this class" — it shows lesson progress —
    // so the check that matters is that it is not frozen.
    expect(tile.className).not.toContain('cursor-default');
  });

  it('counts a class kept in Storage, not just the files in content/', async () => {
    // fetchCatalog merges Supabase `prepared_class` rows into the catalogue, so
    // six topics some earlier student had made are warm too. A gate written
    // against index.json alone would freeze those six.
    catalogue = [];
    vi.stubGlobal('fetch', (url: string) =>
      String(url).includes('index.json')
        ? Promise.resolve(respond({ lessons: [] }))
        : Promise.resolve(respond({ states: {} })),
    );
    const host = await openChapter();
    // With nothing warm anywhere, every tile is frozen — the control case that
    // proves the assertion above was not passing by accident.
    expect(tilesIn(host).every((t) => t.getAttribute('aria-disabled') === 'true')).toBe(true);
  });
});

describe('the route, which is the gate that actually counts', () => {
  /**
   * A tile is one door. /class/* is reachable by a typed URL, a pasted link, a
   * bookmark and the back button, and by two query forms that carry no
   * topicRef at all — so a gate on the buttons alone leaves every one of those
   * open, and this is the test that would catch that.
   *
   * Rendered on the CLIENT, not with renderToString: the gate runs in an
   * effect, and liveclass-screen.test.tsx renders on the server precisely
   * because it is testing the frame before any effect fires.
   */
  const COLD = `${MATHS.id}/${COLD_CHAPTER.id}/${COLD_CHAPTER.topics[0].id}`;

  async function openRoute(path: string): Promise<HTMLElement> {
    const host = mount(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/class/*" element={<LiveClassRoute />} />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await settle(8);
    return host;
  }

  it('refuses a cold topic reached by a pasted link', async () => {
    const host = await openRoute(`/class/${COLD}`);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(PROTOTYPE_NOTICE.title);
  });

  it('refuses a typed topic, which carries no topicRef to judge', async () => {
    const host = await openRoute('/class?topic=How%20a%20rainbow%20forms');
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(PROTOTYPE_NOTICE.title);
  });

  it('never reaches the relay, so nothing is spent and nothing can 403', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      asked.push(String(url));
      return String(url).includes('index.json')
        ? Promise.resolve(respond({ lessons: [] }))
        : Promise.resolve(respond({ states: {} }));
    });
    await openRoute(`/class/${COLD}`);
    // The catalogue is read — that is how warmth is decided. A model call, a
    // prep lock or a ticket is not.
    expect(asked.some((u) => /\/api\/(llm|prep|ticket|speech)/.test(u))).toBe(false);
  });
});

describe('search, when nothing matches', () => {
  it('withdraws the offer instead of leaving a button that walks to a notice', async () => {
    const host = mount(
      <MemoryRouter initialEntries={['/search']}>
        <Search />
      </MemoryRouter>,
    );
    await settle();
    const input = host.querySelector('input')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'quantum tunnelling');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // The offer went to /class?topic=, which has no topicRef and is therefore
    // always a live preparation. A button is worse than no button here: it
    // promises a class and then explains why there is not one.
    expect(host.textContent).not.toContain('Ask her to teach it');
    expect(host.textContent).not.toContain('she can still teach it');
    expect(host.textContent).toContain('still a prototype');
  });
});

describe('the box that asks for anything', () => {
  it('is frozen whole, because both of its doors are always cold', async () => {
    const host = mount(
      <MemoryRouter>
        <AskBox />
      </MemoryRouter>,
    );
    await settle();
    const input = host.querySelector('input:not([type="file"])') as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(input.getAttribute('aria-disabled')).toBe('true');
    expect(input.placeholder).toContain('coming soon');
  });

  it('explains itself when tapped instead of doing nothing', async () => {
    const host = mount(
      <MemoryRouter>
        <AskBox />
      </MemoryRouter>,
    );
    await settle();
    const start = host.querySelector('[aria-label="Start this class"]') as HTMLButtonElement;
    // Not disabled: the tap has to reach the notice, which is the only way the
    // student finds out why nothing happens.
    expect(start.disabled).toBe(false);
    await act(async () => {
      start.click();
    });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain(PROTOTYPE_NOTICE.title);
  });

  it('does not navigate to a class', async () => {
    let at = '';
    const Spy = () => {
      at = useLocation().pathname + useLocation().search;
      return null;
    };
    const host = mount(
      <MemoryRouter initialEntries={['/']}>
        <AskBox />
        <Spy />
      </MemoryRouter>,
    );
    await settle();
    const start = host.querySelector('[aria-label="Start this class"]') as HTMLButtonElement;
    await act(async () => {
      start.click();
    });
    expect(at).toBe('/');
  });
});
