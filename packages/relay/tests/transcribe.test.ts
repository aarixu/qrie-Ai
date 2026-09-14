import { describe, expect, it } from 'vitest';
import { transcribeViaFormData } from '../src/web';
import { HEAR_LANGUAGE, hearRelay, type RelayRequest } from '../src/relays';

/**
 * WHAT THE FORM ACTUALLY CARRIES.
 *
 * The ear shipped for months with a form of `model` and `file` and nothing
 * else, and every test of it passed: they asserted the relay's own return
 * value, which was correct, while the request that left the building told a
 * transcriber to listen in English to Hinglish. So these tests read the
 * FormData itself — the only artefact the vendor ever sees.
 */

const KEY = 'sk-test';
const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

interface Sent {
  url: string;
  form: FormData;
}

/** A fetch that records each form and answers with the statuses given. */
function recordingFetch(statuses: number[]): { fetchImpl: typeof fetch; sent: Sent[] } {
  const sent: Sent[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), form: init!.body as FormData });
    const status = statuses[sent.length - 1] ?? 200;
    return new Response(JSON.stringify(status === 200 ? { text: 'har cell ko oxygen chahiye' } : { error: 'no' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, sent };
}

describe('the multipart form the transcriber is given', () => {
  it('names the language, because the vendor otherwise listens in English', async () => {
    const { fetchImpl, sent } = recordingFetch([200]);
    await transcribeViaFormData(
      KEY,
      { model: 'deepgram/nova-3', language: HEAR_LANGUAGE, contentType: 'audio/wav', audio: AUDIO },
      fetchImpl,
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].form.get('language')).toBe('multi');
    expect(sent[0].form.get('model')).toBe('deepgram/nova-3');
  });

  it('never asks for a language that would come back in Devanagari', async () => {
    /**
     * The end the student is at: a request arrives at the relay ASKING for
     * Hindi, and what leaves is still `multi`. `hi` does not code-switch and
     * emits Devanagari, which would strand all 133 romanised entries in
     * `packages/tutor-judge/src/match.ts` — so the language is not a knob a
     * caller reaches, and this is the seam where that has to hold.
     */
    const req: RelayRequest = {
      method: 'POST',
      url: '/api/hear?language=hi',
      headers: { 'content-type': 'audio/wav' },
      body: AUDIO,
    };
    const heard = hearRelay(req, KEY);
    expect(heard.ok).toBe(true);
    if (!heard.ok) return;

    const { fetchImpl, sent } = recordingFetch([200]);
    const { model, language, contentType, audio } = heard;
    await transcribeViaFormData(KEY, { model, language, contentType, audio }, fetchImpl);

    expect(sent[0].form.get('language')).toBe('multi');
  });

  it('sends the audio with the content type it arrived as', async () => {
    const { fetchImpl, sent } = recordingFetch([200]);
    await transcribeViaFormData(
      KEY,
      { model: 'deepgram/nova-3', language: HEAR_LANGUAGE, contentType: 'audio/webm', audio: AUDIO },
      fetchImpl,
    );

    const file = sent[0].form.get('file') as Blob;
    expect(file.type).toBe('audio/webm');
    expect(file.size).toBe(AUDIO.byteLength);
  });

  it('asks for nothing it has not measured, and for nothing no code reads', async () => {
    /**
     * `response_format: verbose_json` was here for one revision, to collect a
     * confidence nothing read yet. It is unmeasured against deepgram/nova-3
     * through OpenRouter, and an unrecognised parameter on this endpoint can
     * answer with a 200 in another shape — whose missing `text` becomes
     * `reason: 'silence'` in ear.ts, filing a child who spoke as a child who
     * said nothing. That is the defect the language was added to end. The
     * form carries what the vendor is known to take and nothing else; the
     * confidence returns with a live measurement and a reader for it.
     */
    const { fetchImpl, sent } = recordingFetch([200]);
    await transcribeViaFormData(
      KEY,
      { model: 'deepgram/nova-3', language: HEAR_LANGUAGE, contentType: 'audio/wav', audio: AUDIO },
      fetchImpl,
    );

    expect([...sent[0].form.keys()].sort()).toEqual(['file', 'language', 'model']);
  });
});

describe('a vendor that refuses', () => {
  it('is asked once, and never again without the language', async () => {
    /**
     * THE INVARIANT: there is no second attempt, because the only form left to
     * try is the one without `language` — and that one is the English ear,
     * which does not fail, it invents. A refusal reaches ear.ts as `error` and
     * the room says it could not hear; a fluent English sentence the student
     * never said would reach the judge as their answer. Loud beats wrong.
     */
    const { fetchImpl, sent } = recordingFetch([400]);
    const out = await transcribeViaFormData(
      KEY,
      { model: 'deepgram/nova-3', language: HEAR_LANGUAGE, contentType: 'audio/wav', audio: AUDIO },
      fetchImpl,
    );

    expect(sent).toHaveLength(1);
    expect(out.status).toBe(400);
  });

  it('names an upstream that did not answer in JSON rather than passing it on', async () => {
    // An HTML error page from a proxy. Passed through verbatim it breaks every
    // caller's parse, which reads as a bug in the app rather than upstream.
    const fetchImpl = (async () =>
      new Response('<html>502 Bad Gateway</html>', { status: 502 })) as unknown as typeof fetch;
    const out = await transcribeViaFormData(
      KEY,
      { model: 'deepgram/nova-3', language: HEAR_LANGUAGE, contentType: 'audio/wav', audio: AUDIO },
      fetchImpl,
    );

    expect(out.status).toBe(502);
    if (out.body.kind !== 'json') throw new Error('expected json');
    expect(JSON.stringify(out.body.value)).toContain('502 Bad Gateway');
  });
});
