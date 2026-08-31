import type { Lesson } from '@ai-tutor/lesson-format';
import type { TtsAdapter } from './narration';

export type PlayerState = 'idle' | 'playing' | 'paused' | 'ended';
export type PlayerEvent = 'beatchange' | 'statechange';

/**
 * Walks a lesson's beats: speak the narration, hold the beat until BOTH the
 * speech ends AND `max(beat.minMs, opts.minBeatMs, 0)` has elapsed, advance.
 *
 * Framework-free: the only outside world it touches is the injected TtsAdapter
 * and setTimeout, so the whole thing tests in milliseconds with a fake adapter
 * and fake timers.
 *
 * Stale-async guard: every beat start bumps a generation counter, and every
 * interruption (pause/seek/stop) bumps it again. Async completions — a speak()
 * resolving, a minMs timer firing — check the generation they were created
 * under and become no-ops if the player has moved on since. This is what makes
 * "speak() resolves after a seek" harmless.
 */
export class PlayerController {
  private readonly lesson: Lesson;
  private readonly tts: TtsAdapter;
  private readonly minBeatMs: number;

  private _state: PlayerState = 'idle';
  private _beatIndex = 0;
  private generation = 0;
  private minTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Record<PlayerEvent, Set<() => void>> = {
    beatchange: new Set(),
    statechange: new Set(),
  };

  constructor(lesson: Lesson, opts: { tts: TtsAdapter; minBeatMs?: number }) {
    this.lesson = lesson;
    this.tts = opts.tts;
    this.minBeatMs = opts.minBeatMs ?? 0;
  }

  get state(): PlayerState {
    return this._state;
  }

  get beatIndex(): number {
    return this._beatIndex;
  }

  play(): void {
    if (this._state === 'playing') return; // a double-tap must not restart the beat
    if (this.lesson.beats.length === 0) return; // defensive; validation forbids this

    // From paused we re-speak the CURRENT beat from its start: browser TTS has
    // no reliable mid-utterance resume, and a cleanly repeated sentence beats a
    // garbled half one. Resume-mid-sentence comes with cloud TTS word timings.
    const startAt = this._state === 'paused' ? this._beatIndex : 0;
    this._state = 'playing';
    this._beatIndex = startAt; // both fields consistent before any event fires
    this.emit('statechange');
    this.startBeat(startAt);
  }

  pause(): void {
    if (this._state !== 'playing') return;
    // Cancel TTS before anything else — a voice that keeps talking after the
    // pause button is a broken product.
    this.cancelPending();
    this._state = 'paused';
    this.emit('statechange');
  }

  seek(beatIndex: number): void {
    if (!Number.isFinite(beatIndex)) return; // garbage in, no-op out — never throw
    const last = this.lesson.beats.length - 1;
    if (last < 0) return;
    const target = Math.min(last, Math.max(0, Math.floor(beatIndex)));

    if (this._state === 'playing') {
      this.cancelPending();
      this.startBeat(target); // restart narration from the sought beat
      return;
    }
    // idle / paused / ended: just move the position; play() decides what happens next.
    if (target !== this._beatIndex) {
      this._beatIndex = target;
      this.emit('beatchange');
    }
  }

  stop(): void {
    this.cancelPending();
    const movedBeat = this._beatIndex !== 0;
    const changedState = this._state !== 'idle';
    this._beatIndex = 0;
    this._state = 'idle';
    if (movedBeat) this.emit('beatchange');
    if (changedState) this.emit('statechange');
  }

  on(event: PlayerEvent, cb: () => void): () => void {
    const set = this.listeners[event];
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  /** Begin (or re-begin) a beat: move, emit, speak, and arm the minMs floor. */
  private startBeat(index: number): void {
    const gen = ++this.generation;
    this._beatIndex = index;
    this.emit('beatchange');

    const beat = this.lesson.beats[index];
    const minMs = beat.minMs ?? this.minBeatMs;

    // Advance only when BOTH gates open: speech finished AND minMs elapsed.
    let speechDone = false;
    let minDone = minMs <= 0;
    const gate = () => {
      if (gen !== this.generation) return; // superseded by pause/seek/stop
      if (speechDone && minDone) this.advance();
    };

    if (!minDone) {
      this.minTimer = setTimeout(() => {
        this.minTimer = null;
        minDone = true;
        gate();
      }, minMs);
    }

    // A rejected speak() counts as finished speech: a TTS failure should skip
    // a voice line, never stall the class.
    const onSpeechDone = () => {
      speechDone = true;
      gate();
    };
    this.tts.speak(beat.narration).then(onSpeechDone, onSpeechDone);

    /**
     * And the line after it, started now.
     *
     * A voice that fetches pays its time-to-first-byte as silence BETWEEN
     * sentences — about four tenths of a second, once per line, for the whole
     * class. Speech arrives roughly three times faster than it plays, so a
     * line begun at the start of the one before it is ready long before it is
     * wanted, and the pause disappears.
     *
     * The controller is where this belongs because it is the only thing that
     * knows what comes next.
     */
    const next = this.lesson.beats[index + 1];
    if (next) this.tts.prime?.(next.narration);
  }

  private advance(): void {
    const next = this._beatIndex + 1;
    if (next >= this.lesson.beats.length) {
      this._state = 'ended';
      this.emit('statechange');
      return;
    }
    this.startBeat(next);
  }

  /** Invalidate in-flight speech + timer so their completions become no-ops. */
  private cancelPending(): void {
    this.generation++;
    if (this.minTimer !== null) {
      clearTimeout(this.minTimer);
      this.minTimer = null;
    }
    this.tts.cancel();
  }

  private emit(event: PlayerEvent): void {
    // Iterate a copy so a listener unsubscribing mid-emit can't skip its neighbours.
    for (const cb of [...this.listeners[event]]) cb();
  }
}
