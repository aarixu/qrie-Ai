import { fail, checkSavedClass, type RelayResponse, type SavedClass } from './relays.ts';

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
  return { ok: true, value: checked.value };
}
