import { describe, expect, it } from 'vitest';
import { clipFileName, parseClipManifest } from '../src/manifest';

const good = {
  formatVersion: 1,
  lessonId: 'class9-tissues',
  teacher: 'sharma',
  idle: 'idle.mp4',
  beats: { b1: { file: 'b1.mp4', durationMs: 4200, hash: 'abc' } },
};

describe('the clip manifest', () => {
  it('names a clip after its beat', () => {
    expect(clipFileName('b1')).toBe('b1.mp4');
  });

  it('takes a manifest we wrote', () => {
    const m = parseClipManifest(good);
    expect(m?.beats.b1.durationMs).toBe(4200);
    expect(m?.idle).toBe('idle.mp4');
    expect(m?.teacher).toBe('sharma');
  });

  it('refuses anything else, rather than half-playing it', () => {
    expect(parseClipManifest(null)).toBeNull();
    expect(parseClipManifest({ ...good, formatVersion: 2 })).toBeNull();
    // No idle loop means nothing to show between lines - a frozen face.
    expect(parseClipManifest({ ...good, idle: '' })).toBeNull();
    // An entry with no hash could not be checked against the words.
    expect(parseClipManifest({ ...good, beats: { b1: { file: 'b1.mp4' } } })).toBeNull();
  });
});
