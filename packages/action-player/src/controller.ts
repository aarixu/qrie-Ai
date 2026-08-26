import type { Action } from '@openmaic/dsl';
import type { TtsAdapter } from '@ai-tutor/player';
import { initialBoard, type BoardState } from './state';
import { reduce } from './reduce';
import { isBlocking } from './schedule';

export type PlaybackState = 'idle' | 'playing' | 'paused' | 'ended';
export type ControllerEvent = 'change' | 'statechange';

/** How long ink is left to land before the next action starts. */
const DEFAULT_DRAW_MS = 700;

/**
 * Walks an `Action[]`: apply it to the board, then wait for whatever that verb
 * needs — the TTS to finish for `speech`, a short beat for a drawing verb,
 * nothing at all for `spotlight` and `laser` — and move on.
 *
 * Framework-free. The only outside world it touches is the injected TtsAdapter
 * and setTimeout, so it tests in milliseconds with a fake adapter and fake
 * timers. Deliberately the same shape as `@ai-tutor/player`'s
 * `PlayerController`, including its stale-async guard: every step bumps a
 * generation counter, and every interruption bumps it again, so a `speak()`
 * that resolves after a pause or a seek becomes a no-op instead of jumping the
 * lesson forward.
 *
 * This is one half of the product's core. The recorded class is a stored
 * `Action[]` played through here; a live doubt is the same controller fed by an
 * agent producing actions in real time. Nothing pauses and nothing swaps —
 * only the producer changes.
 */
export class ActionController {
  private readonly actions: Action[];
  private readonly tts: TtsAdapter;
  private readonly drawMs: number;

  private _state: PlaybackState = 'idle';
  private _index = 0;
  private _board: BoardState = initialBoard;
  private _caption = '';
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners: Record<ControllerEvent, Set<() => void>> = {
    change: new Set(),
    statechange: new Set(),
  };

  constructor(actions: Action[], opts: { tts: TtsAdapter; drawMs?: number }) {
    this.actions = actions;
    this.tts = opts.tts;
    this.drawMs = opts.drawMs ?? DEFAULT_DRAW_MS;
  }

  get state(): PlaybackState {
    return this._state;
  }

  get index(): number {
    return this._index;
  }

  get board(): BoardState {
    return this._board;
  }

  /** The line being spoken right now, for captions. */
  get caption(): string {
    return this._caption;
  }

  play(): void {
    if (this._state === 'playing') return; // a double-tap must not restart the action
    if (this.actions.length === 0) {
      this.setState('ended'); // an empty stream is over, not stuck
      return;
    }

    // From paused we re-run the CURRENT action rather than resuming inside it:
    // browser TTS has no reliable mid-utterance resume, and a cleanly repeated
    // sentence beats a garbled half one.
    const startAt = this._state === 'paused' ? this._index : 0;
    if (this._state !== 'paused') this.rebuildTo(0);
    this._state = 'playing';
    this.emit('statechange');
    this.step(startAt);
  }

  pause(): void {
    if (this._state !== 'playing') return;
    // Cancel TTS before anything else — a voice that keeps talking after the
    // pause button is a broken product.
    this.cancelPending();
    this.setState('paused');
  }

  stop(): void {
    this.cancelPending();
    this.rebuildTo(0);
    this._caption = '';
    this.emit('change');
    this.setState('idle');
  }

  /**
   * Move to an action index, rebuilding the board by replaying from the start.
   *
   * Replaying rather than stepping backwards is what stops a sought position
   * from being half-drawn: the board at index N is defined as "every action
   * before N, applied in order", and that is exactly what this computes.
   */
  seek(index: number): void {
    if (!Number.isFinite(index)) return; // garbage in, no-op out — never throw
    const last = this.actions.length - 1;
    if (last < 0) return;
    const target = Math.min(last, Math.max(0, Math.floor(index)));

    if (this._state === 'playing') {
      this.cancelPending();
      this.rebuildTo(target);
      this.step(target);
      return;
    }
    this.rebuildTo(target);
    this.emit('change');
  }

  on(event: ControllerEvent, cb: () => void): () => void {
    const set = this.listeners[event];
    set.add(cb);
    return () => {
      set.delete(cb);
    };
  }

  /** Apply one action, then wait for whatever that verb needs before advancing. */
  private step(index: number): void {
    const gen = ++this.generation;
    const action = this.actions[index];
    if (!action) {
      this.setState('ended');
      return;
    }

    this._index = index;
    this._board = reduce(this._board, action);
    if (action.type === 'speech') this._caption = action.text;
    this.emit('change');

    const done = () => {
      if (gen !== this.generation) return; // superseded by pause / seek / stop
      this.advance(index);
    };

    if (action.type === 'speech') {
      // A rejected speak() counts as finished: a TTS failure should skip a voice
      // line, never stall the class.
      this.tts.speak(action.text).then(done, done);
      return;
    }

    // Fire-and-forget verbs get 0ms — a laser points WHILE the tutor keeps
    // talking, which is the whole reason their contract separates the two. The
    // timeout is still a timeout rather than a direct call, so a long run of
    // them cannot grow the stack.
    this.timer = setTimeout(
      () => {
        this.timer = null;
        done();
      },
      isBlocking(action) ? this.drawMs : 0,
    );
  }

  private advance(from: number): void {
    const next = from + 1;
    if (next >= this.actions.length) {
      this.setState('ended');
      return;
    }
    this.step(next);
  }

  /** The board at `index` is every action BEFORE it, plus that action itself. */
  private rebuildTo(index: number): void {
    this._index = index;
    this._board = this.actions.slice(0, index + 1).reduce(reduce, initialBoard);
  }

  /** Invalidate in-flight speech and timers so their completions become no-ops. */
  private cancelPending(): void {
    this.generation++;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.tts.cancel();
  }

  private setState(state: PlaybackState): void {
    if (this._state === state) return;
    this._state = state;
    this.emit('statechange');
  }

  private emit(event: ControllerEvent): void {
    // Iterate a copy so a listener unsubscribing mid-emit can't skip its neighbours.
    for (const cb of [...this.listeners[event]]) cb();
  }
}
