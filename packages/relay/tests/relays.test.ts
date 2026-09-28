import { describe, expect, it } from 'vitest';
import {
  CAP_MAX_TOKENS,
  DEFAULT_SPEECH_VOICE,
  HEAR_LANGUAGE,
  MAX_HEAR_BYTES,
  capMaxTokens,
  checkSavedClass,
  hearRelay,
  llmRelay,
  speechRelay,
  type RelayRequest,
} from '../src/relays';

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  method: 'POST',
  url: '/api/llm',
  headers: {},
  body: new Uint8Array(),
  ...over,
});

const KEY = 'sk-test';

describe('the cap that keeps a low balance usable', () => {
  it('caps an uncapped request, because OpenRouter pre-authorises the whole context', () => {
    const out = JSON.parse(capMaxTokens('{"model":"m","messages":[]}'));
    expect(out.max_tokens).toBe(CAP_MAX_TOKENS);
  });

  it('leaves a caller who asked for a specific budget alone', () => {
    expect(JSON.parse(capMaxTokens('{"max_tokens":100}')).max_tokens).toBe(100);
  });

  it('forwards something that is not JSON rather than mangling it', () => {
    expect(capMaxTokens('not json')).toBe('not json');
  });
});

describe('the llm relay', () => {
  it('refuses anything but POST', () => {
    expect(llmRelay(req({ method: 'GET' }), KEY).status).toBe(405);
  });

  it('says so plainly when the server has no key, rather than calling out unauthenticated', () => {
    expect(llmRelay(req(), '').status).toBe(503);
  });

  it('streams upstream with the key attached and the cap applied', () => {
    const body = new TextEncoder().encode('{"model":"m"}');
    const res = llmRelay(req({ body }), KEY);
    expect(res.body.kind).toBe('stream');
    if (res.body.kind !== 'stream') throw new Error('expected a stream');
    expect(res.body.from.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(res.body.from.body!).max_tokens).toBe(CAP_MAX_TOKENS);
  });

  /**
   * A CHILD'S WORDS ARE NOT TRAINING DATA.
   *
   * OpenRouter routes a call to whichever provider serves the model, and not
   * every provider promises not to keep or train on what it is sent.
   * `provider.data_collection: 'deny'` is how a request refuses those. This path is
   * reached only where Vertex is not configured, but where it is reached, it
   * carries a student's questions.
   */
  describe("the vendor's use of what a student said", () => {
    const sent = (body: string) => {
      const res = llmRelay(req({ body: new TextEncoder().encode(body) }), KEY);
      if (res.body.kind !== 'stream') throw new Error('expected a stream');
      return res.body.from.body!;
    };

    it('asks every provider not to keep it', () => {
      expect(JSON.parse(sent('{"model":"m","messages":[]}')).provider).toEqual({ data_collection: 'deny' });
    });

    it('does not let the caller ask for it to be kept', () => {
      // The body comes from a student's phone. The preference is ours to set.
      const out = JSON.parse(sent('{"model":"m","provider":{"data_collection":"allow"}}'));
      expect(out.provider.data_collection).toBe('deny');
    });

    it("keeps the caller's other routing preferences", () => {
      const out = JSON.parse(sent('{"model":"m","provider":{"order":["google-vertex"]}}'));
      expect(out.provider).toEqual({ order: ['google-vertex'], data_collection: 'deny' });
    });

    it('replaces a provider field that is not an object rather than trusting it', () => {
      for (const provider of ['"allow"', 'null', '[1]']) {
        const out = JSON.parse(sent(`{"model":"m","provider":${provider}}`));
        expect(out.provider, provider).toEqual({ data_collection: 'deny' });
      }
    });

    it('still caps the output, and still honours a smaller ask', () => {
      expect(JSON.parse(sent('{"model":"m"}')).max_tokens).toBe(CAP_MAX_TOKENS);
      expect(JSON.parse(sent('{"model":"m","max_tokens":100}')).max_tokens).toBe(100);
    });

    it('forwards a body that is not a JSON object untouched, for upstream to refuse', () => {
      expect(sent('not json')).toBe('not json');
      expect(sent('[1,2]')).toBe('[1,2]');
    });
  });
});

describe('the speech relay', () => {
  it('has nothing to say without text', () => {
    expect(speechRelay(req({ url: '/api/speech' }), KEY).status).toBe(400);
  });

  it('asks for mp3 and carries the named voice through', () => {
    const res = speechRelay(req({ url: '/api/speech?text=hi&voice=aura-2-thalia-en' }), KEY);
    if (res.body.kind !== 'stream') throw new Error('expected a stream');
    const sent = JSON.parse(res.body.from.body!);
    expect(sent.input).toBe('hi');
    expect(sent.voice).toBe('aura-2-thalia-en');
    expect(sent.response_format).toBe('mp3');
    expect(res.body.from.fallbackContentType).toBe('audio/mpeg');
  });

  it('always names a voice, because the provider now insists on one', () => {
    // Measured against the live relay: OpenRouter answers aura-2 with no voice
    // as 400, "An explicit voice is required for this TTS provider". The app
    // always passes one, which is why nothing here ever showed it — the first
    // caller to rely on the default would have found a 400 with no reason.
    const res = speechRelay(req({ url: '/api/speech?text=hi' }), KEY);
    if (res.body.kind !== 'stream') throw new Error('expected a stream');

    expect(JSON.parse(res.body.from.body!).voice).toBe(DEFAULT_SPEECH_VOICE);
  });

  it('uses the same voice the classroom does', () => {
    // The default and the app must be the same person, not two.
    expect(DEFAULT_SPEECH_VOICE).toBe('aura-2-thalia-en');
  });

  /**
   * What she is asked to say was written for one child, in one class. The
   * same preference llmRelay sets.
   */
  it('asks the vendor not to keep what it is asked to say', () => {
    const res = speechRelay(req({ url: '/api/speech?text=hi' }), KEY);
    if (res.body.kind !== 'stream') throw new Error('expected a stream');
    expect(JSON.parse(res.body.from.body!).provider).toEqual({ data_collection: 'deny' });
  });
});

describe('the ear', () => {
  it('refuses an empty body', () => {
    const out = hearRelay(req({ url: '/api/hear' }), KEY);
    expect(out.ok).toBe(false);
  });

  it('hands the audio on with the model it should be transcribed by', () => {
    const out = hearRelay(req({ url: '/api/hear', body: new Uint8Array([1, 2, 3]), headers: { 'content-type': 'audio/wav' } }), KEY);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.model).toBe('deepgram/nova-3');
    expect(out.audio.byteLength).toBe(3);
  });

  it('says which language it is listening in, because the vendor defaults to English', () => {
    // Nothing said so until 2026-09-14, so the only ear this product has left
    // was an English model transcribing Class 10 Hinglish — and a transcriber
    // in the wrong language does not go quiet, it invents fluent words that
    // then reach the judge as the child's answer.
    const out = hearRelay(req({ url: '/api/hear', body: new Uint8Array([1]) }), KEY);
    if (!out.ok) throw new Error('expected the audio to be accepted');
    expect(out.language).toBe(HEAR_LANGUAGE);
    expect(out.language).toBe('multi');
  });

  it('ignores a caller asking for Hindi, which would arrive in Devanagari', () => {
    // `hi` is single-language — Deepgram documents code-switching as needing
    // `multi` — and its output is Devanagari, which would Devanagari-ise every
    // English science term and strand the 133 romanised entries in
    // `packages/tutor-judge/src/match.ts`. The model stays overridable; this
    // does not, because no value of it is an improvement on `multi`.
    const out = hearRelay(req({ url: '/api/hear?language=hi&model=deepgram/nova-2', body: new Uint8Array([1]) }), KEY);
    if (!out.ok) throw new Error('expected the audio to be accepted');
    expect(out.language).toBe('multi');
    expect(out.model).toBe('deepgram/nova-2');
  });
});

describe('what a browser is allowed to write', () => {
  const good = {
    id: 'class9-tissues',
    entry: {
      id: 'class9-tissues',
      title: 'Animal Tissues',
      class: 9,
      subject: 'Science',
      path: 'class9-tissues/lesson.json',
      topicRef: 'class9-science/tissues/animal-tissues',
    },
    files: [{ path: 'lesson.json', body: '{}', encoding: 'utf8' as const }],
  };

  it('takes a well-formed class', () => {
    expect(checkSavedClass(good).ok).toBe(true);
  });

  /**
   * THE ENTRY BECOMES A ROW EVERY LATER STUDENT IS SERVED.
   *
   * It used to be checked as `typeof entry.id === 'string'` and nothing else,
   * while the deployed writer reads its title, class, subject and topicRef
   * straight into Postgres — all of it arriving over HTTP from a browser.
   */
  const brokenEntries: [string, Record<string, unknown>][] = [
    ['no title', { title: undefined }],
    ['empty title', { title: '' }],
    ['no subject', { subject: undefined }],
    ['a class that is not a school class', { class: 3 }],
    ['a class that is not a number', { class: '9' }],
    ['no topicRef', { topicRef: undefined }],
    ['a topicRef of the wrong shape', { topicRef: 'just-a-slug' }],
    ['a subtitle that is not text', { subtitle: 42 }],
  ];

  it.each(brokenEntries)('refuses an entry with %s', (_why, over) => {
    expect(checkSavedClass({ ...good, entry: { ...good.entry, ...over } }).ok).toBe(false);
  });

  it('refuses a topicRef with an empty segment', () => {
    // "a//c" splits into three too. A topicRef nothing can join on becomes a
    // row under a unique key, and ignore-duplicates then swallows the correct
    // save for that topic forever.
    for (const topicRef of ['//', 'a//c', '/b/c', 'a/b/']) {
      expect(
        checkSavedClass({ ...good, entry: { ...good.entry, topicRef } }).ok,
        topicRef,
      ).toBe(false);
    }
  });

  it('refuses more files than any class this app makes', () => {
    // Anonymous sign-in means an identity costs nothing and the daily budget
    // allows six hundred of these. Without a ceiling that is unmetered storage.
    const many = Array.from({ length: 30 }, (_, i) => ({
      path: `generated/${i}.png`,
      body: 'x',
      encoding: 'utf8' as const,
    }));

    expect(checkSavedClass({ ...good, files: many }).ok).toBe(false);
  });

  it('refuses a class larger than any class this app makes', () => {
    const huge = [{ path: 'lesson.json', body: 'x'.repeat(13 * 1024 * 1024), encoding: 'utf8' as const }];

    expect(checkSavedClass({ ...good, files: huge }).ok).toBe(false);
  });

  it('takes a class the size of a real one', () => {
    const real = [
      { path: 'lesson.json', body: '{}', encoding: 'utf8' as const },
      ...Array.from({ length: 6 }, (_, i) => ({
        path: `generated/${i}.png`,
        body: 'x'.repeat(400_000),
        encoding: 'base64' as const,
      })),
    ];

    expect(checkSavedClass({ ...good, files: real }).ok).toBe(true);
  });

  it('takes an optional subtitle when it is text', () => {
    expect(
      checkSavedClass({ ...good, entry: { ...good.entry, subtitle: 'Class 9 · Tissues' } }).ok,
    ).toBe(true);
  });

  it('refuses an id that is not a plain slug — it becomes a folder name', () => {
    for (const id of ['../etc', 'Class9', 'a b', '/abs', '']) {
      expect(checkSavedClass({ ...good, id }).ok, id).toBe(false);
    }
  });

  it('refuses any path that could climb out of its folder, in any spelling', () => {
    for (const path of ['../x.json', '/etc/passwd', 'a\..\b', 'generated/../../x']) {
      expect(checkSavedClass({ ...good, files: [{ ...good.files[0], path }] }).ok, path).toBe(false);
    }
  });

  it('refuses an encoding it would have to guess at', () => {
    expect(checkSavedClass({ ...good, files: [{ ...good.files[0], encoding: 'hex' }] }).ok).toBe(false);
  });
});

/**
 * HER VOICE, FROM A BOX WE RENT.
 *
 * 86% of what a class costs is speech, and every rupee of it is cash to a
 * vendor while the models run on credits. `tools/speech` serves the same thing
 * from our own machine — measured on an ordinary laptop, Piper runs at 10.4x
 * realtime with the first audio at 0.25-0.37s, against the vendor's measured
 * 0.36s time-to-first-byte. So this is not a cheaper-but-slower trade; it is
 * the same latency for rent instead of per character.
 */
describe('speaking through our own service', () => {
  const url = (r: ReturnType<typeof speechRelay>) =>
    r.body && typeof r.body === 'object' && 'from' in r.body
      ? (r.body as { from: { url: string; method: string; headers: Record<string, string>; body?: string } }).from
      : null;

  const asked = (qs: string) => ({ url: `/api/speech?${qs}`, method: 'GET', headers: {}, body: new Uint8Array() });

  it('goes to our box when one is configured, and carries no credential', () => {
    const out = speechRelay(asked('text=Har%20cell%20zinda%20hai'), 'sk-vendor-key', 'http://127.0.0.1:8123');
    const from = url(out);
    expect(from?.url).toContain('http://127.0.0.1:8123/speak?');
    expect(from?.url).toContain('text=Har+cell+zinda+hai');
    expect(from?.method).toBe('GET');
    // There is no key to send, which is the whole point of the service being
    // ours. A vendor key leaking into a request that does not need one is how
    // a credential ends up somewhere nobody audits.
    expect(JSON.stringify(from?.headers ?? {})).not.toContain('sk-vendor-key');
  });

  it('never sends our box a voice name, because every name the app has is the vendor’s', () => {
    /**
     * THE REQUEST THE CLASSROOM ACTUALLY MAKES, not one a test invented.
     *
     * `TUTOR_VOICE` in apps/classroom/src/lib/lessonVoice.ts is the only voice
     * this product asks for and it is this constant — a Deepgram name. Our box
     * resolves a voice as `<name>.onnx` on disk, so forwarding it answered 404
     * to every line of every class and the room fell back to the browser's
     * robot voice for the whole lesson. The test this replaces passed
     * `hi_IN-pratham-medium`, a name nothing in this product can produce, so
     * it proved the forwarding worked and never that it was survivable.
     */
    const from = url(speechRelay(asked(`text=hi&voice=${DEFAULT_SPEECH_VOICE}`), '', 'http://box'));
    expect(from?.url).not.toContain('voice=');
    expect(from?.url).not.toContain(DEFAULT_SPEECH_VOICE);
    // And the vendor path still names one on every call, because an unnamed
    // voice there is a tutor who changes speaker between sentences.
    expect(url(speechRelay(asked('text=hi'), 'sk-vendor-key'))?.body).toContain(DEFAULT_SPEECH_VOICE);
  });

  it('needs no vendor key at all, which a laptop with no account still has to work without', () => {
    expect(speechRelay(asked('text=hi'), '', 'http://box').status).toBe(200);
    // And without a box, the vendor key is back to being required.
    expect(speechRelay(asked('text=hi'), '').status).toBe(503);
  });

  it('still refuses an empty line, whoever is speaking it', () => {
    expect(speechRelay(asked('text=%20%20'), '', 'http://box').status).toBe(400);
  });

  it('goes to the vendor exactly as before when no box is configured', () => {
    const from = url(speechRelay(asked('text=hi'), 'sk-vendor-key'));
    expect(from?.url).toContain('openrouter.ai');
    expect(JSON.stringify(from?.headers)).toContain('sk-vendor-key');
  });

  it('does not let a trailing slash produce a double one', () => {
    expect(url(speechRelay(asked('text=hi'), '', 'http://box/'))?.url).toContain('http://box/speak?');
  });
});

/**
 * WHAT THE METER IS ABLE TO PRICE.
 *
 * `unitsFor` turns a hear body into seconds by dividing by 32,000 — the bytes
 * a second of the raw 16 kHz mono `ear.ts` posts. That arithmetic is only true
 * of that format. A compressed body of the same duration is a fraction of the
 * bytes and would be charged a fraction of the units: 16 kbps opus is about
 * 2,000 bytes a second, sixteen times under, and a day's budget would buy
 * something like seventy-seven hours of transcription. The per-minute request
 * limit is nowhere near binding on a body that large.
 *
 * So the bad state is refused rather than priced.
 */
describe('the ear takes only what the meter can read', () => {
  const post = (bytes: number, contentType = 'audio/wav') => ({
    method: 'POST',
    url: '/api/hear',
    headers: { 'content-type': contentType },
    body: new Uint8Array(bytes),
  });

  it('takes a real answer', () => {
    // Ten seconds at 16 kHz 16-bit mono, which is the endpointer's hard stop.
    expect(hearRelay(post(320_000), 'k').ok).toBe(true);
  });

  it('refuses a body longer than any answer the room can make', () => {
    const out = hearRelay(post(MAX_HEAR_BYTES + 1), 'k');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(413);
  });

  it('refuses a format whose bytes do not mean seconds', () => {
    // The sixteen-times hole, closed at the door rather than in the meter.
    for (const type of ['audio/webm', 'audio/ogg;codecs=opus', 'audio/mpeg', 'application/json']) {
      const out = hearRelay(post(1_000, type), 'k');
      expect(out.ok, type).toBe(false);
      if (!out.ok) expect(out.response.status, type).toBe(415);
    }
  });

  it('accepts the spellings of wav a browser may send, and ignores a charset', () => {
    for (const type of ['audio/wav', 'AUDIO/WAV', 'audio/wave', 'audio/x-wav', 'audio/wav; codecs=1']) {
      expect(hearRelay(post(1_000, type), 'k').ok, type).toBe(true);
    }
  });

  it('still refuses an empty body before anything else', () => {
    const out = hearRelay(post(0), 'k');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.response.status).toBe(400);
  });
});
