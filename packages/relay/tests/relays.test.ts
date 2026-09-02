import { describe, expect, it } from 'vitest';
import {
  CAP_MAX_TOKENS,
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

  it('sends no voice at all rather than an empty one', () => {
    const res = speechRelay(req({ url: '/api/speech?text=hi' }), KEY);
    if (res.body.kind !== 'stream') throw new Error('expected a stream');
    expect(JSON.parse(res.body.from.body!)).not.toHaveProperty('voice');
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
