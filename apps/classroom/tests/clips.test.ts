import { describe, expect, it } from 'vitest';
import { hashNarration } from '@ai-tutor/voice';
import type { ClipManifest } from '@ai-tutor/teacher-clone';
import { clipFor } from '../src/avatar/clips';

const narration = 'Water leaves the puddle without ever boiling.';
const manifest: ClipManifest = {
  formatVersion: 1,
  lessonId: 'l',
  teacher: 'sharma',
  idle: 'idle.mp4',
  beats: { b1: { file: 'b1.mp4', durationMs: 3000, hash: hashNarration(narration) } },
};

describe('which clip plays', () => {
  it('plays the take rendered for exactly these words', () => {
    expect(clipFor(manifest, '/x', 'b1', narration)).toBe('/x/clips/b1.mp4');
  });

  it('survives a re-wrap of the same words, as the recording does', () => {
    expect(clipFor(manifest, '/x', 'b1', '  Water leaves the puddle\n  without ever boiling.  ')).toBe(
      '/x/clips/b1.mp4',
    );
  });

  it('refuses a take rendered for different words — the lips would lie', () => {
    expect(clipFor(manifest, '/x', 'b1', 'Some other sentence entirely.')).toBeNull();
  });

  it('has nothing for a beat that was never rendered', () => {
    expect(clipFor(manifest, '/x', 'b2', narration)).toBeNull();
  });
});
