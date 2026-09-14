import type { SourcePage } from './sourceText';

/**
 * HOW A PAGE THE STUDENT BROUGHT REACHES THE CLASSROOM.
 *
 * `/class?topic=<what they typed>` works because a topic is five words and a
 * URL can hold five words. An extracted chapter is twelve thousand characters,
 * and putting that in a query string would mean a URL longer than several
 * browsers accept, a student's own notes sitting in the address bar and in
 * every back/forward entry, and — since the app tracks the path of every
 * screen — the one piece of student data the telemetry comment promises is
 * dropped. So the URL carries a KEY and nothing else, and the page itself
 * never leaves this tab.
 *
 * TWO PLACES, ON PURPOSE. The map always works, including where storage is
 * switched off or full; sessionStorage is what survives the one reload that
 * actually happens — the student pulls to refresh while she is preparing, or
 * the classroom remounts on Try again — and it is sessionStorage rather than
 * localStorage because a chapter somebody uploaded has no business outliving
 * the tab they uploaded it in. Closing the tab is deleting it.
 */

const PREFIX = 'curie.source.';

/** The tab's own copy. Authoritative, and the only one guaranteed to exist. */
const held = new Map<string, SourcePage>();

/**
 * A key with nothing in it.
 *
 * Random rather than derived from the file, because a key derived from the
 * name is the file name back in the URL — which is the thing this module
 * exists to keep out of it.
 */
export function freshSourceKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Put the page where the classroom can find it. The key is handed in. */
export function holdSource(key: string, page: SourcePage): void {
  held.set(key, page);
  try {
    globalThis.sessionStorage?.setItem(`${PREFIX}${key}`, JSON.stringify(page));
  } catch {
    // Private browsing, a full quota, storage turned off. The map above is
    // still holding it, so the class still starts; only a reload would lose
    // it, and that is a better failure than refusing the file.
  }
}

/**
 * The page for this key, or null if it is gone.
 *
 * Null is an ordinary answer, not a fault: a student who bookmarks
 * /class?source=… and opens it next week gets a tab that never held that file.
 * The classroom says so and shows them the way back rather than spinning.
 *
 * Reading does not remove it. The classroom's effect runs twice under
 * StrictMode and again on Try again, and a take-once would have made the
 * second read a missing file.
 */
export function takeSource(key: string): SourcePage | null {
  const inMemory = held.get(key);
  if (inMemory) return inMemory;

  let raw: string | null = null;
  try {
    raw = globalThis.sessionStorage?.getItem(`${PREFIX}${key}`) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SourcePage>;
    // Checked rather than trusted: this came out of storage, which anything
    // running on this origin can write to, and it is about to be composed into
    // a prompt. The safety screen still runs on the text afterwards; this is
    // only about the SHAPE being what the classroom expects.
    if (typeof parsed.title !== 'string' || typeof parsed.text !== 'string') return null;
    const page: SourcePage = {
      title: parsed.title,
      text: parsed.text,
      truncated: parsed.truncated === true,
    };
    held.set(key, page);
    return page;
  } catch {
    return null;
  }
}

/**
 * Forget every page this tab is holding.
 *
 * No SCREEN calls this yet — flagged, not deleted, per the standing rule. Its
 * only callers today are the tests, which need a clean tab between cases. What
 * brings it back is either of two things already on the road: a "forget what I
 * brought" control, and signing out on a shared phone, where the next student
 * must not find the last one's notes still loaded.
 */
export function forgetSources(): void {
  held.clear();
  try {
    const storage = globalThis.sessionStorage;
    if (!storage) return;
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (key?.startsWith(PREFIX)) storage.removeItem(key);
    }
  } catch {
    // Nothing to clear if there is nothing to clear from.
  }
}
