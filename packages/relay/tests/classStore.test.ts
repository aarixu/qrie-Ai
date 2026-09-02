import { describe, expect, it } from 'vitest';
import { keepClass, publicUrlFor, readSavedClass } from '../src/classStore';
import type { SavedClass } from '../src/relays';

/**
 * KEEPING A CLASS SO THE NEXT STUDENT GETS IT FREE.
 *
 * A topic is prepared once — fifty seconds and about ₹2.25 — and everyone
 * after that downloads it. That is the whole economic case for warm entry, and
 * it was not true in production: /api/class answered 501, so every student
 * re-prepared every topic they touched.
 */

const saved: SavedClass = {
  id: 'class9-science-tissues-animal-tissues',
  entry: {
    id: 'class9-science-tissues-animal-tissues',
    title: 'Animal Tissues',
    subtitle: 'Class 9 · Tissues',
    class: 9,
    subject: 'Science',
    path: 'class9-science-tissues-animal-tissues/lesson.json',
    topicRef: 'class9-science/tissues/animal-tissues',
  },
  files: [
    { path: 'lesson.json', body: '{"formatVersion":1}', encoding: 'utf8' },
    { path: 'generated/neuron.png', body: 'aGVsbG8=', encoding: 'base64' },
  ],
};

/** Records every call and answers with whatever it is told to. */
function recorder(answers: { ok: boolean; status?: number; text?: string }[] = []) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body,
    });
    const answer = answers.shift() ?? { ok: true };
    return {
      ok: answer.ok,
      status: answer.status ?? (answer.ok ? 200 : 500),
      text: async () => answer.text ?? '',
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const opts = (fetchImpl: typeof fetch) => ({
  supabaseUrl: 'https://p.supabase.co',
  serviceRoleKey: 'service-key',
  fetchImpl,
});

describe('keepClass', () => {
  it('writes every file, then the catalogue row', async () => {
    const { calls, fetchImpl } = recorder();

    const out = await keepClass(saved, opts(fetchImpl));

    expect(out.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toContain('/storage/v1/object/classes/class9-science-tissues-animal-tissues/lesson.json');
    expect(calls[1].url).toContain('/generated/neuron.png');
    expect(calls[2].url).toContain('/rest/v1/prepared_class');
  });

  it('writes the row LAST', async () => {
    // A row pointing at files that are not there is a lesson every student
    // sees and none of them can open. Files with no row are invisible and
    // cost a little storage. A partial failure must leave the cheaper mess.
    const { calls, fetchImpl } = recorder();

    await keepClass(saved, opts(fetchImpl));

    expect(calls.at(-1)!.url).toContain('prepared_class');
  });

  it('does not write the row when a file could not be stored', async () => {
    const { calls, fetchImpl } = recorder([{ ok: false, status: 507, text: 'no space' }]);

    const out = await keepClass(saved, opts(fetchImpl));

    expect(out.status).toBe(507);
    expect(calls.some((c) => c.url.includes('prepared_class'))).toBe(false);
  });

  it('carries on when a file is already there', async () => {
    // Two students reaching the same cold topic within a minute of each other
    // is an ordinary Tuesday, not a fault.
    const { fetchImpl } = recorder([{ ok: false, status: 409, text: 'exists' }]);

    expect((await keepClass(saved, opts(fetchImpl))).status).toBe(200);
  });

  it('asks the catalogue to ignore a duplicate rather than fail on one', async () => {
    const { calls, fetchImpl } = recorder();

    await keepClass(saved, opts(fetchImpl));

    expect(calls.at(-1)!.headers.prefer).toContain('ignore-duplicates');
  });

  it('sends the row the shape the table expects', async () => {
    const { calls, fetchImpl } = recorder();

    await keepClass(saved, opts(fetchImpl));

    expect(JSON.parse(String(calls.at(-1)!.body))).toEqual({
      id: saved.id,
      topic_ref: 'class9-science/tissues/animal-tissues',
      title: 'Animal Tissues',
      subtitle: 'Class 9 · Tissues',
      klass: 9,
      subject: 'Science',
    });
  });

  it('uses the service role key, which never leaves the server', async () => {
    const { calls, fetchImpl } = recorder();

    await keepClass(saved, opts(fetchImpl));

    for (const call of calls) {
      expect(call.headers.authorization).toBe('Bearer service-key');
    }
  });

  it('says so plainly when storage cannot be reached at all', async () => {
    const fetchImpl = (async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    expect((await keepClass(saved, opts(fetchImpl))).status).toBe(502);
  });
});

describe('readSavedClass', () => {
  const bytes = (value: unknown): Uint8Array =>
    new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));

  it('takes a well-formed class', () => {
    const out = readSavedClass(bytes(saved));

    expect(out.ok).toBe(true);
    expect(out.ok && out.value.id).toBe(saved.id);
  });

  it('refuses something that is not JSON', () => {
    const out = readSavedClass(bytes('not json at all'));

    expect(out.ok).toBe(false);
    expect(!out.ok && out.response.status).toBe(400);
  });

  it('refuses a file path that climbs out of its folder', () => {
    const escaping = { ...saved, files: [{ path: '../../etc/passwd', body: 'x', encoding: 'utf8' }] };

    expect(readSavedClass(bytes(escaping)).ok).toBe(false);
  });

  it('refuses a class with no topic, which nobody could ever ask for', () => {
    const free = { ...saved, entry: { ...saved.entry, topicRef: '' } };

    expect(readSavedClass(bytes(free)).ok).toBe(false);
  });
});

describe('publicUrlFor', () => {
  it('points at the bucket the migration creates', () => {
    expect(publicUrlFor('https://p.supabase.co', 'abc', 'lesson.json')).toBe(
      'https://p.supabase.co/storage/v1/object/public/classes/abc/lesson.json',
    );
  });
});
