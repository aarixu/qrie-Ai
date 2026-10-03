import { describe, expect, it } from 'vitest';
import { EAR_DEFAULTS, createEndpointer, wavOf } from '../src/lib/ear';

/**
 * The endpointer: when has the student started, and when have they finished.
 * Fed synthetic loudness levels a chunk at a time, the way the mic feeds it.
 */

const QUIET = 0.01;
const SPEECH = 0.5;
const MS = 100;

describe('hearing one answer end', () => {
  it('waits through quiet, hears speech, ends on the trailing silence', () => {
    const ear = createEndpointer();
    for (let i = 0; i < 5; i += 1) expect(ear.feed(QUIET, MS)).toBe('waiting');
    expect(ear.feed(SPEECH, MS)).toBe('listening');
    for (let i = 0; i < 9; i += 1) expect(ear.feed(SPEECH, MS)).toBe('listening');
    // 1.4 s of silence is a child thinking mid-sentence, not the end (Aarav,
    // 2026-10-03: his sentences were cut where he paused)...
    for (let i = 0; i < 14; i += 1) expect(ear.feed(QUIET, MS)).toBe('listening');
    // ...1.5 s is the end.
    expect(ear.feed(QUIET, MS)).toBe('heard');
  });

  it('a mid-answer pause resets the silence clock instead of ending the answer', () => {
    const ear = createEndpointer();
    ear.feed(SPEECH, MS);
    for (let i = 0; i < 8; i += 1) expect(ear.feed(QUIET, MS)).toBe('listening');
    expect(ear.feed(SPEECH, MS)).toBe('listening'); // they carried on
    for (let i = 0; i < 14; i += 1) expect(ear.feed(QUIET, MS)).toBe('listening');
    expect(ear.feed(QUIET, MS)).toBe('heard');
  });

  it('gives up quietly when nobody speaks at all', () => {
    const ear = createEndpointer();
    const chunks = EAR_DEFAULTS.graceMs / MS;
    for (let i = 0; i < chunks - 1; i += 1) expect(ear.feed(QUIET, MS)).toBe('waiting');
    expect(ear.feed(QUIET, MS)).toBe('nothing');
  });

  it('takes a rambling answer whole at the cap rather than holding forever', () => {
    const ear = createEndpointer();
    expect(ear.feed(SPEECH, MS)).toBe('listening');
    let state = '';
    for (let i = 0; i < EAR_DEFAULTS.maxSpeechMs / MS; i += 1) state = ear.feed(SPEECH, MS);
    expect(state).toBe('heard');
  });
});

describe('the wav wrapper', () => {
  it('writes a header the transcriber can trust', () => {
    const pcm = new Int16Array([0, 1000, -1000]);
    const buf = wavOf(pcm, 16000);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + 6);
    const tag = (at: number): string =>
      String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint32(24, true)).toBe(16000); // sample rate
    expect(v.getUint32(40, true)).toBe(6); // data bytes
    expect(v.getInt16(46, true)).toBe(1000); // first real sample after the header
  });
});
