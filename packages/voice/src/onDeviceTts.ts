import type { TtsAdapter } from '@ai-tutor/player';
import type { SpeechElement } from './streamingTts.ts';
import { noteSpoken, noteTrouble } from './voiceReport.ts';
import { wavUrl } from './wav.ts';

/**
 * HER VOICE, MADE ON THE PHONE.
 *
 * No relay, no key, no network, and no per-line cost. It is also the only way
 * a class works on a train, which for a student in India is most of the ways a
 * class gets taken.
 *
 * THE TIMING PROBLEM, and why `prime` is the whole design. Measured: 2.7x
 * realtime on a laptop, 0.7x on a 4 GB Mali phone. At 0.7x a four-second line
 * takes nearly six seconds to make, so synthesising when the line is reached
 * would put a five-second silence in front of every sentence. But a class is
 * WRITTEN BEFORE IT IS SPOKEN — prep already takes thirty to sixty seconds
 * behind a progress bar — and the player calls `prime` on the line after the
 * one it is speaking. So the making happens during the speaking, one line
 * ahead, and the student hears none of it.
 *
 * WHAT IT IS NOT. It is not a fallback for the cloud voice; it is what the
 * cloud voice was standing in for. The `fallback` here is for the first line
 * of the first class, before the model has loaded — a 263 MB download happens
 * once, and a student should not sit in silence waiting for it.
 */

/** What a synthesiser has to be able to do. Injected, so this file has no model in it. */
export interface Synthesiser {
  /** Samples and their rate, or null if this line could not be made. */
  speak(text: string): Promise<{ samples: Float32Array; sampleRate: number } | null>;
}

export interface OnDeviceTtsOptions {
  synth: Synthesiser;
  /** Builds the player. The avatar's own factory, so the mouth still syncs. */
  audio?: (src: string) => SpeechElement;
  /**
   * Who speaks while the model is still arriving.
   *
   * The cloud voice, usually. A first class on a cold install would otherwise
   * open with a minute of silence, and "it is downloading" is not something a
   * thirteen-year-old is owed as an explanation for a broken tutor.
   */
  fallback?: TtsAdapter;
  /**
   * How many primed lines to keep.
   *
   * Each is a few hundred kilobytes of PCM held as a blob. Six is two or three
   * beats of lookahead, which is more than the player ever asks for, and a
   * bound is here at all because a long class would otherwise hold every line
   * it has spoken for as long as the room is open.
   */
  keep?: number;
}

const DEFAULT_KEEP = 6;

export function createOnDeviceTts(options: OnDeviceTtsOptions): TtsAdapter {
  const { synth, fallback } = options;
  const makeAudio = options.audio ?? ((src: string) => new Audio(src) as SpeechElement);
  const keep = options.keep ?? DEFAULT_KEEP;

  /** Lines already made, or being made. Keyed by the text itself. */
  const ready = new Map<string, Promise<string | null>>();
  let playing: SpeechElement | null = null;
  let stopped = false;

  /**
   * Made once per line, however many times it is asked for.
   *
   * `prime` and `speak` race on the same text constantly — the player primes
   * line N+1 and then speaks it — and without this the phone would synthesise
   * every line twice, which at 0.7x realtime is the difference between
   * seamless and unusable.
   */
  const make = (text: string): Promise<string | null> => {
    const already = ready.get(text);
    if (already) return already;

    /**
     * Timed, and the failure is REPORTED rather than swallowed.
     *
     * This layer is built to fail quietly — the cloud voice is behind it and
     * the class carries on — which is right for a student and useless for
     * anyone testing whether the phone did the work at all. A class that
     * sounds fine proves nothing without this.
     */
    const started = Date.now();
    const work = synth
      .speak(text)
      .then((made) => {
        if (!made) {
          noteTrouble('on-device', 'the model made no audio for a line');
          return null;
        }
        noteSpoken('on-device', text, Date.now() - started);
        return wavUrl(made.samples, made.sampleRate);
      })
      .catch((e: unknown) => {
        noteTrouble('on-device', (e as Error)?.message ?? 'synthesis threw');
        return null;
      });
    ready.set(text, work);

    // Oldest first, and the URL is revoked: a blob nobody released is a leak
    // that grows with the length of the class.
    while (ready.size > keep) {
      const oldest = ready.keys().next().value as string;
      const going = ready.get(oldest);
      ready.delete(oldest);
      void going?.then((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    }
    return work;
  };

  const play = (url: string): Promise<void> =>
    new Promise<void>((done) => {
      const el = makeAudio(url);
      playing = el;
      let done_ = false;
      const finish = () => {
        if (done_) return;
        done_ = true;
        if (playing === el) playing = null;
        done();
      };
      el.onended = finish;
      // An audio element that fails to decode must not hang the class on a
      // promise nobody resolves. The beat moves on silently, which is what
      // every other voice layer here does with a line it cannot say.
      el.onerror = finish;
      void Promise.resolve(el.play()).catch(finish);
    });

  return {
    prime(text: string) {
      if (!stopped) void make(text);
    },

    async speak(text: string) {
      stopped = false;
      const url = await make(text);
      if (stopped) return;
      if (url) {
        await play(url);
        return;
      }
      // Nothing was made — the model is still loading, or this line defeated
      // it. Somebody still has to say the sentence.
      await fallback?.speak(text);
    },

    cancel() {
      stopped = true;
      playing?.pause?.();
      playing = null;
      fallback?.cancel();
    },
  };
}
