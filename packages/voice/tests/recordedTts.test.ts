import { describe, expect, it, vi } from 'vitest';
import type { TtsAdapter } from '@ai-tutor/player';
import { hashNarration } from '../src/hash';
import {
  createRecordedTts,
  parseManifest,
  audioFileName,
  type FilePlayback,
  type FilePlayer,
  type NarrationManifest,
  type PlaybackResult,
} from '../src/recordedTts';

const HOOK = 'Blood is a tissue, not just a red liquid.';
const PLASMA = 'Plasma is mostly water, and it carries everything else.';

const manifestOf = (overrides: Partial<NarrationManifest> = {}): NarrationManifest => ({
  formatVersion: 1,
  lessonId: 'blood-and-its-components',
  voice: 'Sulafat',
  model: 'gemini-3.1-flash-tts-preview',
  beats: {
    hook: { file: audioFileName('hook'), durationMs: 4_200, hash: hashNarration(HOOK) },
    plasma: { file: audioFileName('plasma'), durationMs: 6_100, hash: hashNarration(PLASMA) },
  },
  ...overrides,
});

function fakeFilePlayer(options: { result?: PlaybackResult; auto?: boolean } = {}) {
  const calls: { url: string; durationMs: number }[] = [];
  const settlers: ((result: PlaybackResult) => void)[] = [];
  let stops = 0;

  const player: FilePlayer = {
    play(url: string, durationMs: number): FilePlayback {
      calls.push({ url, durationMs });
      let settle: (result: PlaybackResult) => void = () => undefined;
      const finished = new Promise<PlaybackResult>((resolve) => {
        settle = resolve;
      });
      settlers.push(settle);
      if (options.auto !== false) settle(options.result ?? 'played');
      return {
        finished,
        stop: () => {
          stops += 1;
          settle('stopped');
        },
      };
    },
  };

  return { player, calls, settlers, stops: () => stops };
}

function recordingFallback(): { adapter: TtsAdapter; spoken: string[]; cancels: () => number } {
  const spoken: string[] = [];
  let cancels = 0;
  return {
    spoken,
    cancels: () => cancels,
    adapter: {
      speak: (text: string) => {
        spoken.push(text);
        return Promise.resolve();
      },
      cancel: () => {
        cancels += 1;
      },
    },
  };
}

describe('createRecordedTts', () => {
  it('plays the recorded take when the narration still matches the hash', async () => {
    const files = fakeFilePlayer();
    const fallback = recordingFallback();

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/content/blood-and-its-components/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
    });
    await tts.speak(HOOK);

    expect(files.calls).toEqual([
      { url: '/content/blood-and-its-components/audio/hook.m4a', durationMs: 4_200 },
    ]);
    expect(fallback.spoken).toEqual([]);
  });

  it('matches on the words, not on layout — re-wrapping a line keeps the take', async () => {
    const files = fakeFilePlayer();
    const fallback = recordingFallback();

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/audio/',
      fallback: fallback.adapter,
      filePlayer: files.player,
    });
    await tts.speak('Blood is a tissue,\n    not just a red liquid.');

    expect(files.calls[0].url).toBe('/audio/hook.m4a');
    expect(fallback.spoken).toEqual([]);
  });

  it('falls through when the narration was edited after the render', async () => {
    const files = fakeFilePlayer();
    const fallback = recordingFallback();
    const onFallthrough = vi.fn();
    const edited = `${HOOK} About half of it is plasma.`;

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
      onFallthrough,
    });
    await tts.speak(edited);

    expect(files.calls).toEqual([]); // stale audio must never be played
    expect(fallback.spoken).toEqual([edited]);
    expect(onFallthrough).toHaveBeenCalledWith({ text: edited, reason: 'not-recorded' });
  });

  it('falls through for a beat that was never recorded', async () => {
    const files = fakeFilePlayer();
    const fallback = recordingFallback();

    const tts = createRecordedTts({
      manifest: manifestOf({ beats: {} }),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
    });
    await tts.speak(HOOK);

    expect(files.calls).toEqual([]);
    expect(fallback.spoken).toEqual([HOOK]);
  });

  it('refuses a file name that could walk out of the lesson folder', async () => {
    const files = fakeFilePlayer();
    const fallback = recordingFallback();
    const onFallthrough = vi.fn();

    const tts = createRecordedTts({
      manifest: manifestOf({
        beats: { hook: { file: '../../secrets.m4a', durationMs: 1, hash: hashNarration(HOOK) } },
      }),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
      onFallthrough,
    });
    await tts.speak(HOOK);

    expect(files.calls).toEqual([]);
    expect(fallback.spoken).toEqual([HOOK]);
    expect(onFallthrough).toHaveBeenCalledWith({ text: HOOK, reason: 'unsafe-file' });
  });

  it('speaks the line live when the file will not play', async () => {
    const files = fakeFilePlayer({ result: 'failed' });
    const fallback = recordingFallback();
    const onFallthrough = vi.fn();

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
      onFallthrough,
    });
    await tts.speak(PLASMA);

    expect(files.calls).toHaveLength(1);
    expect(fallback.spoken).toEqual([PLASMA]);
    expect(onFallthrough).toHaveBeenCalledWith({ text: PLASMA, reason: 'playback-failed' });
  });

  it('resolves speak() only when the take has finished', async () => {
    const files = fakeFilePlayer({ auto: false });
    const fallback = recordingFallback();

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
    });

    let resolved = false;
    const speaking = tts.speak(HOOK).then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    files.settlers[0]('played');
    await speaking;
    expect(resolved).toBe(true);
  });

  it('stops the take and resolves the pending speak when a hand goes up', async () => {
    const files = fakeFilePlayer({ auto: false });
    const fallback = recordingFallback();

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
    });

    const speaking = tts.speak(HOOK);
    tts.cancel();

    await expect(speaking).resolves.toBeUndefined();
    expect(files.stops()).toBe(1);
    expect(fallback.cancels()).toBe(1);
  });

  it('does not start the fallback for a take the student interrupted', async () => {
    const files = fakeFilePlayer({ auto: false });
    const fallback = recordingFallback();

    const tts = createRecordedTts({
      manifest: manifestOf(),
      baseUrl: '/audio',
      fallback: fallback.adapter,
      filePlayer: files.player,
    });

    const speaking = tts.speak(HOOK);
    tts.cancel();
    await speaking;
    await Promise.resolve();

    expect(fallback.spoken).toEqual([]);
  });
});

describe('parseManifest', () => {
  it('accepts a manifest the recorder wrote', () => {
    const manifest = manifestOf();
    expect(parseManifest(JSON.parse(JSON.stringify(manifest)))).toEqual(manifest);
  });

  it('rejects anything else, so a lesson opens without a recording rather than failing', () => {
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest('<!doctype html>')).toBeNull();
    expect(parseManifest({ ...manifestOf(), formatVersion: 2 })).toBeNull();
    expect(parseManifest({ ...manifestOf(), beats: 'none' })).toBeNull();
    expect(
      parseManifest({ ...manifestOf(), beats: { hook: { file: 'hook.m4a', hash: 'abc' } } }),
    ).toBeNull();
  });
});
