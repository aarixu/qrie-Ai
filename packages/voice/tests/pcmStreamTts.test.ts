import { describe, expect, it } from 'vitest';
import type { TtsAdapter } from '@ai-tutor/player';
import { createPcmStreamTts, pcmBytesToFloat32, type PcmOutput } from '../src/pcmStreamTts';

/**
 * HER VOICE AS IT IS MADE (2026-09-28).
 *
 * The relay streams Gemini's raw 24 kHz PCM; this plays each chunk the moment
 * it lands, scheduled gaplessly after the last, so she starts speaking on the
 * first chunk (~1.4 s measured) instead of when the whole line is ready. An
 * `<audio>` element could not do this: Chromium would not start a streamed WAV
 * until ~240 KB had arrived.
 */

/** A fake speaker with a hand-driven clock. */
function fakeOutput() {
  const played: { samples: number; at: number; stopped: boolean }[] = [];
  let clock = 0;
  const out: PcmOutput = {
    now: () => clock,
    play(samples, _sampleRate, at) {
      const entry = { samples: samples.length, at, stopped: false };
      played.push(entry);
      return { stop: () => (entry.stopped = true) };
    },
  };
  return { out, played, advance: (s: number) => (clock += s) };
}

/** A relay that answers with the given byte chunks, one per tick. */
function fakeRelay(bodies: Record<string, { status?: number; type?: string; chunks: number[][] }>) {
  const asked: string[] = [];
  const aborted: string[] = [];
  const fetchImpl = async (url: string, init: { signal: AbortSignal }): Promise<Response> => {
    asked.push(url);
    const text = new URL(url, 'http://x').searchParams.get('text') ?? '';
    const spec = bodies[text] ?? { chunks: [] };
    init.signal.addEventListener('abort', () => aborted.push(text));
    const stream = new ReadableStream<Uint8Array>({
      async start(c) {
        for (const chunk of spec.chunks) {
          await new Promise((r) => setTimeout(r, 1));
          if (init.signal.aborted) return;
          c.enqueue(new Uint8Array(chunk));
        }
        c.close();
      },
    });
    return new Response(stream, { status: spec.status ?? 200, headers: { 'content-type': spec.type ?? 'audio/L16;rate=24000;channels=1' } });
  };
  return { fetchImpl, asked, aborted };
}

const sleepNow = async () => {
  await new Promise((r) => setTimeout(r, 0));
};

function spyFallback() {
  const said: string[] = [];
  const fb: TtsAdapter = {
    speak: async (t) => {
      said.push(t);
    },
    cancel: () => undefined,
  };
  return { fb, said };
}

describe('pcmBytesToFloat32', () => {
  it('reads little-endian 16-bit samples into -1..1', () => {
    const f = pcmBytesToFloat32(new Uint8Array([0x00, 0x00, 0xff, 0x7f, 0x00, 0x80]));
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(1, 3);
    expect(f[2]).toBe(-1);
  });
});

describe('createPcmStreamTts', () => {
  it('plays each chunk as it lands, one after another with no gap', async () => {
    const { out, played } = fakeOutput();
    const relay = fakeRelay({ hello: { chunks: [[0, 0, 0, 0], [0, 0, 0, 0, 0, 0]] } });
    const tts = createPcmStreamTts({ endpoint: '/api/speech', output: () => out, fetch: relay.fetchImpl, sleep: sleepNow });
    await tts.speak('hello');
    expect(played.map((p) => p.samples)).toEqual([2, 3]);
    // The second chunk starts exactly where the first ends (2 samples at 24 kHz).
    expect(played[1].at).toBeCloseTo(played[0].at + 2 / 24_000, 9);
  });

  it('asks the relay for raw PCM, in the child\'s language, with the pass', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ hi: { chunks: [[0, 0]] } });
    const tts = createPcmStreamTts({
      endpoint: 'https://r/api/speech',
      output: () => out,
      fetch: relay.fetchImpl,
      sleep: sleepNow,
      ticket: () => 'T1',
      session: () => 'S1',
      lang: () => 'hi-en',
    });
    await tts.speak('hi');
    const q = new URL(relay.asked[0]).searchParams;
    expect(q.get('format')).toBe('pcm');
    expect(q.get('lang')).toBe('hi-en');
    expect(q.get('ticket')).toBe('T1');
    expect(q.get('session')).toBe('S1');
    expect(q.get('model')).toBeNull();
  });

  it('never splits a sample across two chunks', async () => {
    const { out, played } = fakeOutput();
    const relay = fakeRelay({ odd: { chunks: [[1, 2, 3], [4, 5, 6]] } });
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, sleep: sleepNow });
    await tts.speak('odd');
    expect(played.reduce((n, p) => n + p.samples, 0)).toBe(3);
  });

  it('falls back to the browser voice when the relay refuses', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ nope: { status: 502, chunks: [] } });
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, fallback: fb, sleep: sleepNow });
    await tts.speak('nope');
    expect(said).toEqual(['nope']);
  });

  it('refuses anything that is not raw PCM — an old relay answering mp3 would play as static', async () => {
    const { out, played } = fakeOutput();
    const relay = fakeRelay({ mp3: { type: 'audio/mpeg', chunks: [[0xff, 0xfb, 0x90, 0x00]] } });
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, fallback: fb, sleep: sleepNow });
    await tts.speak('mp3');
    expect(played).toHaveLength(0);
    expect(said).toEqual(['mp3']);
  });

  it('falls back when a 200 carries no audio at all', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ empty: { chunks: [] } });
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, fallback: fb, sleep: sleepNow });
    await tts.speak('empty');
    expect(said).toEqual(['empty']);
  });

  it('does not say a line twice when it simply finished', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ fine: { chunks: [[0, 0]] } });
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, fallback: fb, sleep: sleepNow });
    await tts.speak('fine');
    expect(said).toEqual([]);
  });

  it('waits for the last sample to be heard before resolving', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ long: { chunks: [new Array(48_000).fill(0)] } }); // one second
    const waited: number[] = [];
    const tts = createPcmStreamTts({
      endpoint: '/s',
      output: () => out,
      fetch: relay.fetchImpl,
      sleep: async (ms) => {
        waited.push(ms);
      },
    });
    await tts.speak('long');
    expect(Math.max(...waited)).toBeGreaterThanOrEqual(1000);
  });

  it('cancel stops the sound, the download, and resolves the line', async () => {
    const { out, played } = fakeOutput();
    const relay = fakeRelay({ talk: { chunks: [[0, 0], [0, 0], [0, 0], [0, 0]] } });
    let release: () => void = () => undefined;
    const tts = createPcmStreamTts({
      endpoint: '/s',
      output: () => out,
      fetch: relay.fetchImpl,
      sleep: () => new Promise<void>((r) => (release = r)),
    });
    const line = tts.speak('talk');
    await new Promise((r) => setTimeout(r, 20));
    tts.cancel();
    release();
    await line;
    expect(played.every((p) => p.stopped)).toBe(true);
  });

  it('starts fetching a primed line early and plays it without asking again', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ one: { chunks: [[0, 0]] }, two: { chunks: [[0, 0]] } });
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, sleep: sleepNow });
    tts.prime!('two');
    await tts.speak('one');
    await tts.speak('two');
    expect(relay.asked.filter((u) => u.includes('text=two'))).toHaveLength(1);
  });

  it('drops a primed line that is replaced before it is spoken', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ a: { chunks: [[0, 0], [0, 0]] }, b: { chunks: [[0, 0]] } });
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, sleep: sleepNow });
    tts.prime!('a');
    tts.prime!('b');
    await new Promise((r) => setTimeout(r, 10));
    expect(relay.aborted).toContain('a');
  });

  /**
   * THE PRIMED LINE, ON A CLASS THAT HAS STOPPED.
   *
   * `cancel` ends the line being spoken and leaves the prefetch alone, which
   * is right for a seek: the next line is still wanted. After the class halts
   * nothing is wanted, and the prefetch is a request still being paid for.
   * `drop` is the way to throw it away.
   */
  it('cancel leaves a primed line fetching; drop aborts it', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ next: { chunks: [[0, 0], [0, 0], [0, 0], [0, 0]] } });
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, sleep: sleepNow });
    tts.prime!('next');
    await new Promise((r) => setTimeout(r, 0));

    tts.cancel();
    await new Promise((r) => setTimeout(r, 0));
    expect(relay.aborted).not.toContain('next');

    tts.drop!();
    await new Promise((r) => setTimeout(r, 0));
    expect(relay.aborted).toContain('next');
  });

  it('after drop, the dropped line is fetched afresh if it is ever spoken', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ next: { chunks: [[0, 0]] } });
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => out, fetch: relay.fetchImpl, sleep: sleepNow });
    tts.prime!('next');
    tts.drop!();
    await tts.speak('next');
    expect(relay.asked.filter((u) => u.includes('text=next'))).toHaveLength(2);
  });

  it('tells the caller when her voice actually starts', async () => {
    const { out } = fakeOutput();
    const relay = fakeRelay({ go: { chunks: [[0, 0]] } });
    const started: string[] = [];
    const tts = createPcmStreamTts({
      endpoint: '/s',
      output: () => out,
      fetch: relay.fetchImpl,
      sleep: sleepNow,
      onStart: (t) => started.push(t),
    });
    await tts.speak('go');
    await new Promise((r) => setTimeout(r, 100));
    expect(started).toEqual(['go']);
  });

  it('speaks through the fallback when there is no audio output at all', async () => {
    const relay = fakeRelay({ x: { chunks: [[0, 0]] } });
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({ endpoint: '/s', output: () => null, fetch: relay.fetchImpl, fallback: fb, sleep: sleepNow });
    await tts.speak('x');
    expect(said).toEqual(['x']);
  });
});

/**
 * NOTHING HERE MAY FREEZE A CLASS, AND CANCEL MEANS CANCEL (overnight review
 * #9, #12, #31).
 */
describe('createPcmStreamTts: stalls and cancels', () => {
  /** A relay that answers headers, sends `chunks`, then never sends another byte. */
  function stallingRelay(chunks: number[][]) {
    const fetchImpl = async (_url: string, init: { signal: AbortSignal }): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          for (const chunk of chunks) c.enqueue(new Uint8Array(chunk));
          init.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return new Response(stream, { headers: { 'content-type': 'audio/L16;rate=24000;channels=1' } });
    };
    return fetchImpl;
  }

  it('speaks through the fallback when the first byte never comes', async () => {
    const { out } = fakeOutput();
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({
      endpoint: '/speech',
      output: () => out,
      fallback: fb,
      fetch: stallingRelay([]),
      sleep: sleepNow,
      deadlines: { firstChunkMs: 20, stallMs: 20 },
    });
    await tts.speak('Hello there.');
    expect(said).toEqual(['Hello there.']);
  });

  it('ends a line whose stream stalls after it started, instead of waiting forever', async () => {
    const { out, played } = fakeOutput();
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({
      endpoint: '/speech',
      output: () => out,
      fallback: fb,
      fetch: stallingRelay([[1, 0, 2, 0]]),
      sleep: sleepNow,
      deadlines: { firstChunkMs: 20, stallMs: 20 },
    });
    await tts.speak('Hello there.');
    expect(played).toHaveLength(1);
    // Part of it was heard: saying it again from the top would repeat her.
    expect(said).toEqual([]);
  });

  it('a fetch that ignores its abort signal still cannot hold the line', async () => {
    const { out } = fakeOutput();
    const { fb, said } = spyFallback();
    const tts = createPcmStreamTts({
      endpoint: '/speech',
      output: () => out,
      fallback: fb,
      fetch: () => new Promise<Response>(() => {}),
      sleep: sleepNow,
      deadlines: { firstChunkMs: 20, stallMs: 20 },
    });
    await tts.speak('Hello there.');
    expect(said).toEqual(['Hello there.']);
  });

  it('cancel stops a line the fallback voice is speaking', async () => {
    const { out } = fakeOutput();
    let cancelled = 0;
    let finish: () => void = () => undefined;
    const fb: TtsAdapter = {
      speak: () => new Promise<void>((r) => (finish = r)),
      cancel: () => {
        cancelled += 1;
        finish();
      },
    };
    const { fetchImpl } = fakeRelay({ 'Hello there.': { status: 503, chunks: [] } });
    const tts = createPcmStreamTts({ endpoint: '/speech', output: () => out, fallback: fb, fetch: fetchImpl, sleep: sleepNow });
    const speaking = tts.speak('Hello there.');
    await new Promise((r) => setTimeout(r, 10));
    tts.cancel();
    await speaking;
    expect(cancelled).toBe(1);
  });

  it('cancel stops the fallback when there is no audio output at all', async () => {
    let cancelled = 0;
    let finish: () => void = () => undefined;
    const fb: TtsAdapter = {
      speak: () => new Promise<void>((r) => (finish = r)),
      cancel: () => {
        cancelled += 1;
        finish();
      },
    };
    const { fetchImpl } = fakeRelay({});
    const tts = createPcmStreamTts({ endpoint: '/speech', output: () => null, fallback: fb, fetch: fetchImpl, sleep: sleepNow });
    const speaking = tts.speak('Hello there.');
    await new Promise((r) => setTimeout(r, 0));
    tts.cancel();
    await speaking;
    expect(cancelled).toBe(1);
  });
});

describe('createPcmStreamTts: the line goes in a body, not a URL (overnight review #2)', () => {
  it('asks through `request` when one is given, with the words and language, and plays the answer', async () => {
    const { out, played } = fakeOutput();
    const asked: { words: string; lang: string | null }[] = [];
    const tts = createPcmStreamTts({
      endpoint: '/speech',
      output: () => out,
      lang: () => 'hi-en',
      request: async (words, lang, signal) => {
        asked.push({ words, lang });
        expect(signal).toBeInstanceOf(AbortSignal);
        return new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'audio/L16;rate=24000;channels=1' } });
      },
      fetch: () => {
        throw new Error('the GET route must not be used when `request` is given');
      },
      sleep: sleepNow,
    });
    await tts.speak('Hi Ishaan!');
    expect(asked).toEqual([{ words: 'Hi Ishaan!', lang: 'hi-en' }]);
    expect(played).toHaveLength(1);
  });
});
