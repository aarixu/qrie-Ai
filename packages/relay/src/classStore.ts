import { fail, checkSavedClass, type RelayResponse, type SavedClass } from './relays.ts';
// By relative path with the extension, like relays.ts reaches the safety
// screen: this file runs unchanged in Deno, which has no workspace aliases.
import { validateLesson } from '../../lesson-format/src/validate.ts';
import { screenSpine } from '../../class-prep/src/screenSpine.ts';

/**
 * KEEPING A CLASS THE TUTOR JUST MADE.
 *
 * A topic is prepared once — about ₹30, the planning figure every document
 * here uses (docs/prd/6-cost-monetisation-ops.md:573, band ₹26-40) — and every
 * student after that gets it for the cost of a download. That is the entire
 * economic case for warm entry, and until this existed it was not true in
 * production:
 * /api/class answered 501, so every student re-prepared every topic they
 * touched and paid for it again.
 *
 * The dev server writes the same files into content/ with a vite plugin. This
 * is the deployed half: Storage for the files, one Postgres row for the
 * catalogue. Both are reached over plain HTTP with the service role key, so
 * this file has no SDK and runs unchanged in Deno.
 *
 * A TOPIC IS ONLY COLD ONCE. A second preparation is refused rather than
 * overwritten — the dev writer already makes that choice, for the same reason:
 * a later student must not be able to replace the recording an earlier one
 * made, and two students arriving at the same cold topic within a minute of
 * each other is an ordinary Tuesday.
 *
 * KEPT IS NOT PUBLISHED (I1). Every class this route keeps goes into the
 * catalogue as review_status 'pending', and the app serves only 'published'
 * rows that carry no retracted_at (apps/classroom/src/lib/content.ts), as does
 * the preparation lock's 'ready' (prep.ts). Publishing is an operator's act,
 * done by hand after the spot check — nothing in this checkout does it. What
 * that costs, said plainly:
 *   - EVERY keep lands pending, the prewarm runner's included: it posts with
 *     a bearer token like any student's, and nothing here tells the two apart.
 *   - A pending row still holds its topic_ref. The row write ignores
 *     duplicates and a file already stored answers 409, so a LATER keep of
 *     the same topic — a reviewed prewarm after a student's — is swallowed
 *     until an operator deletes or publishes the row that is there.
 *   - Until a topic is published, every student who opens it prepares it
 *     again, at the full preparation price.
 */

const BUCKET = 'classes';

export interface ClassStoreOptions {
  supabaseUrl: string;
  serviceRoleKey: string;
  fetchImpl?: typeof fetch;
}

/** Where a kept class's files are served from. */
export const publicUrlFor = (supabaseUrl: string, id: string, path: string): string =>
  `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${id}/${path}`;

/**
 * base64 to bytes, without Buffer.
 *
 * Node has Buffer and Deno does not, and this package refuses to depend on
 * either. `atob` is a web standard both of them carry.
 */
function bytesFrom(body: string, encoding: 'utf8' | 'base64'): Uint8Array {
  if (encoding === 'utf8') return new TextEncoder().encode(body);
  const binary = atob(body);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

const contentTypeFor = (path: string): string => {
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
};

/**
 * Write one class: every file, then the catalogue row.
 *
 * THE ROW GOES LAST, and that ordering is the whole error design. A row
 * pointing at files that are not there yet is a lesson every student sees in
 * the catalogue and none of them can open; files with no row are invisible
 * and cost nothing but a little storage. So a partial failure leaves the
 * cheaper kind of mess.
 */
export async function keepClass(
  saved: SavedClass,
  opts: ClassStoreOptions,
): Promise<RelayResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const headers = {
    apikey: opts.serviceRoleKey,
    authorization: `Bearer ${opts.serviceRoleKey}`,
  };

  for (const file of saved.files) {
    const url = `${opts.supabaseUrl}/storage/v1/object/${BUCKET}/${saved.id}/${file.path}`;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { ...headers, 'content-type': contentTypeFor(file.path) },
        // Uint8Array over its own buffer: a view onto a shared one is not a
        // BodyInit, and the slice is a copy rather than a window.
        body: bytesFrom(file.body, file.encoding).slice().buffer as ArrayBuffer,
      });
    } catch (e) {
      return fail(502, `could not reach storage: ${e instanceof Error ? e.message : String(e)}`);
    }
    // 409 is this exact file already being there, which means another student
    // beat us to the same cold topic. That is a race, not a fault.
    if (!res.ok && res.status !== 409) {
      return fail(res.status, `storage refused ${file.path}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  let res: Response;
  try {
    res = await fetchImpl(`${opts.supabaseUrl}/rest/v1/prepared_class`, {
      method: 'POST',
      headers: {
        ...headers,
        'content-type': 'application/json',
        // Do nothing if the topic is already kept. Two students reaching the
        // same cold topic together is ordinary, and the first one wins.
        prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify({
        id: saved.id,
        topic_ref: saved.entry.topicRef,
        title: saved.entry.title,
        subtitle: saved.entry.subtitle ?? null,
        klass: saved.entry.class,
        subject: saved.entry.subject,
        // Kept, not published: see the header. The column's own default is
        // 'published' (0018), so leaving this out would publish on keep.
        review_status: 'pending',
      }),
    });
  } catch (e) {
    return fail(502, `could not reach the catalogue: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    return fail(res.status, `the catalogue refused it: ${(await res.text()).slice(0, 200)}`);
  }

  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: { kind: 'json', value: { ok: true, id: saved.id } },
  };
}

/**
 * Read a POSTed class, checked before anything is written.
 *
 * `checkSavedClass` is the same validator the dev writer uses: an id that is a
 * slug and nothing else, and no file path that can climb out of its own
 * folder. Both of those arrive over HTTP from a browser, so neither is
 * trusted.
 */
export function readSavedClass(body: Uint8Array): { ok: true; value: SavedClass } | { ok: false; response: RelayResponse } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, response: fail(400, 'that is not JSON') };
  }
  const checked = checkSavedClass(parsed);
  if (!checked.ok) return { ok: false, response: fail(400, checked.why) };
  if (!checked.value.entry.topicRef) {
    // A free-text class has no topic to be asked for by, so nobody could ever
    // find it again. saveable() already refuses these; this is the server
    // saying the same thing rather than trusting the client to have.
    return { ok: false, response: fail(400, 'a class with no topic is not kept') };
  }
  const lessonChecked = checkLesson(checked.value);
  if (lessonChecked !== null) return { ok: false, response: lessonChecked };
  return { ok: true, value: checked.value };
}

/**
 * THE LESSON ITSELF, READ BEFORE ANYTHING IS STORED (I1).
 *
 * `checkSavedClass` reads the envelope — ids, paths, sizes, markup, and a
 * distress screen over each file as raw text. Nothing read the LESSON: a
 * browser could keep a lesson.json the app would refuse to play (the app
 * validates at load and shows "not available", content.ts fetchLesson), and
 * it would still hold its topic's one row. So:
 *   - lesson.json must be there, and must pass `validateLesson` — the same
 *     function the app loads it with;
 *   - it must name the class it is kept as (saveable writes that id);
 *   - its SPINE is screened string by string (class-prep's screenSpine),
 *     which catches what a screen over the raw file cannot: a line broken
 *     mid-sentence is "to\nkill" in the file and "to kill" to the student.
 * A refusal names the place and never quotes the line.
 *
 * The keep gate's other rules (class-prep's gate.ts: overlap, one question
 * per ask, notation, outcome ids, maths) are NOT re-run here; the report that
 * says whether they passed is not part of what a class posts.
 */
function checkLesson(saved: SavedClass): RelayResponse | null {
  const file = saved.files.find((f) => f.path === 'lesson.json');
  if (!file || file.encoding !== 'utf8') return fail(400, 'a class needs its lesson.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.body);
  } catch {
    return fail(400, 'lesson.json is not JSON');
  }
  const valid = validateLesson(parsed);
  if (!valid.ok) return fail(400, `lesson.json is not a playable lesson: ${valid.errors[0]}`);
  if (valid.lesson.id !== saved.id) return fail(400, 'the lesson inside names a different class');
  const distressed = screenSpine(valid.lesson);
  if (distressed.length > 0) {
    return fail(400, `lesson.json carries a line that reads as distress (at ${distressed[0].where})`);
  }
  return null;
}
