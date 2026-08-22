import { describe, expect, it, vi } from 'vitest';
import {
  MIC_SAMPLE_RATE,
  base64ToInt16,
  createPcmChunker,
  downsampleTo16k,
  floatTo16BitPCM,
  int16ToBase64,
  nextStartTime,
  pcm16ToFloat32,
} from '../src/lib/audio';

describe('floatTo16BitPCM', () => {
  it('maps the full range to the full range of int16', () => {
    const pcm = floatTo16BitPCM(new Float32Array([0, 1, -1, 0.5, -0.5]));
    expect(pcm[0]).toBe(0);
    expect(pcm[1]).toBe(32767);
    expect(pcm[2]).toBe(-32768);
    expect(pcm[3]).toBe(Math.round(0.5 * 0x7fff));
    expect(pcm[4]).toBe(Math.round(-0.5 * 0x8000));
  });

  it('clips beyond +/-1.0 instead of wrapping', () => {
    // Wrapping would flip the sign of a loud sample — an audible click.
    const pcm = floatTo16BitPCM(new Float32Array([2.5, -2.5, 1.0001, -1.0001]));
    expect([...pcm]).toEqual([32767, -32768, 32767, -32768]);
  });

  it('handles empty input', () => {
    expect(floatTo16BitPCM(new Float32Array(0)).length).toBe(0);
  });
});

describe('pcm16ToFloat32', () => {
  it('round-trips exactly at both extremes and at zero', () => {
    const original = new Float32Array([0, 1, -1]);
    const back = pcm16ToFloat32(floatTo16BitPCM(original));
    expect([...back]).toEqual([0, 1, -1]);
  });

  it('round-trips ordinary samples within one quantisation step', () => {
    const original = new Float32Array([0.25, -0.75, 0.001, -0.333]);
    const back = pcm16ToFloat32(floatTo16BitPCM(original));
    for (let i = 0; i < original.length; i += 1) {
      expect(Math.abs(back[i] - original[i])).toBeLessThan(1 / 32767);
    }
  });

  it('keeps every decoded sample inside the playable range', () => {
    const back = pcm16ToFloat32(new Int16Array([-32768, 32767, 0]));
    for (const v of back) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });
});

describe('int16ToBase64 / base64ToInt16', () => {
  it('round-trips a signal', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 12345, -12345]);
    expect([...base64ToInt16(int16ToBase64(pcm))]).toEqual([...pcm]);
  });

  it('round-trips empty input', () => {
    expect(int16ToBase64(new Int16Array(0))).toBe('');
    expect(base64ToInt16('').length).toBe(0);
  });

  it('encodes little-endian', () => {
    // 0x0102 little-endian is the bytes 02 01.
    const b64 = int16ToBase64(new Int16Array([0x0102]));
    const bytes = [...atob(b64)].map((c) => c.charCodeAt(0));
    expect(bytes).toEqual([0x02, 0x01]);
  });

  it('drops a trailing odd byte rather than reading past the buffer', () => {
    const oddByteCount = btoa('abc'); // 3 bytes -> 1 whole sample
    expect(base64ToInt16(oddByteCount).length).toBe(1);
  });

  it('survives a long chunk without hitting the argument limit', () => {
    // Longer than the 0x8000 stride used internally.
    const pcm = new Int16Array(70_000);
    for (let i = 0; i < pcm.length; i += 1) pcm[i] = ((i * 37) % 65536) - 32768;
    expect([...base64ToInt16(int16ToBase64(pcm))]).toEqual([...pcm]);
  });
});

describe('downsampleTo16k', () => {
  it('keeps the length ratio going from 48 kHz to 16 kHz', () => {
    const input = new Float32Array(300);
    const out = downsampleTo16k(input, 48000);
    expect(out.length).toBe(100);
  });

  it('averages each source window rather than dropping samples', () => {
    // 3:1 — each output sample is the mean of three inputs.
    const out = downsampleTo16k(new Float32Array([0, 0.5, 1, -1, -0.5, 0]), 48000);
    expect(out.length).toBe(2);
    expect(out[0]).toBeCloseTo(0.5, 6);
    expect(out[1]).toBeCloseTo(-0.5, 6);
  });

  it('preserves a constant signal exactly', () => {
    const input = new Float32Array(48).fill(0.4);
    const out = downsampleTo16k(input, 48000);
    for (const v of out) expect(v).toBeCloseTo(0.4, 6);
  });

  it('returns the input untouched when it is already at or below 16 kHz', () => {
    const input = new Float32Array([0.1, 0.2, 0.3]);
    expect(downsampleTo16k(input, MIC_SAMPLE_RATE)).toBe(input);
    expect(downsampleTo16k(input, 8000)).toBe(input);
  });

  it('handles empty input', () => {
    expect(downsampleTo16k(new Float32Array(0), 48000).length).toBe(0);
  });

  it('ignores a nonsense rate instead of producing NaN audio', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(downsampleTo16k(input, Number.NaN)).toBe(input);
    expect(downsampleTo16k(input, 0)).toBe(input);
  });

  it('drops the ragged tail when the ratio does not divide evenly', () => {
    // 44.1 kHz -> 16 kHz is 2.75625 input samples per output sample, so 1000
    // samples yield 362 whole ones and the remainder is discarded.
    const out = downsampleTo16k(new Float32Array(1000), 44100);
    expect(out.length).toBe(362);
  });
});

describe('createPcmChunker', () => {
  it('emits only whole chunks and keeps the remainder', () => {
    const chunks: Int16Array[] = [];
    const chunker = createPcmChunker(100, (c) => chunks.push(c));

    chunker.push(new Int16Array(250));
    expect(chunks.length).toBe(2);

    chunker.push(new Int16Array(50));
    expect(chunks.length).toBe(3);
    for (const c of chunks) expect(c.length).toBe(100);
  });

  it('preserves the sample stream across chunk boundaries', () => {
    const chunks: Int16Array[] = [];
    const chunker = createPcmChunker(4, (c) => chunks.push(c));

    chunker.push(new Int16Array([1, 2, 3]));
    chunker.push(new Int16Array([4, 5, 6, 7, 8]));

    expect(chunks.map((c) => [...c])).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it('gives each chunk its own buffer', () => {
    // A recycled buffer would be overwritten while still queued on the socket.
    const chunks: Int16Array[] = [];
    const chunker = createPcmChunker(2, (c) => chunks.push(c));
    chunker.push(new Int16Array([1, 1, 2, 2]));
    expect([...chunks[0]]).toEqual([1, 1]);
    expect([...chunks[1]]).toEqual([2, 2]);
    expect(chunks[0].buffer).not.toBe(chunks[1].buffer);
  });

  it('drops the partial tail on reset', () => {
    const onChunk = vi.fn();
    const chunker = createPcmChunker(4, onChunk);
    chunker.push(new Int16Array([1, 2, 3]));
    chunker.reset();
    chunker.push(new Int16Array([9, 9, 9, 9]));
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect([...(onChunk.mock.calls[0][0] as Int16Array)]).toEqual([9, 9, 9, 9]);
  });

  it('never emits a zero-length chunk for a degenerate size', () => {
    const onChunk = vi.fn();
    const chunker = createPcmChunker(0, onChunk);
    chunker.push(new Int16Array([5]));
    expect(onChunk).toHaveBeenCalledTimes(1);
    expect([...(onChunk.mock.calls[0][0] as Int16Array)]).toEqual([5]);
  });
});

describe('nextStartTime', () => {
  it('butts the next buffer against what is already queued', () => {
    expect(nextStartTime(1.0, 3.5, 0.06)).toBe(3.5);
  });

  it('never schedules in the past when the queue has drained', () => {
    // Starting at 0 (or at a stale queue time) renders as a click.
    expect(nextStartTime(10, 4, 0.06)).toBeCloseTo(10.06, 6);
    expect(nextStartTime(10, 0, 0.06)).toBeCloseTo(10.06, 6);
  });
});
