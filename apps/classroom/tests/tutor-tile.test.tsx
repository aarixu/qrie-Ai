import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ClipManifest } from '@ai-tutor/teacher-clone';
import { TUTOR } from '@ai-tutor/persona';
import { TutorTile } from '../src/ui/TutorTile';

/**
 * WHICH FACE THE TILE SHOWS.
 *
 * Curie's own students see the penguin — he is her tutor, and a client
 * engagement must not quietly replace him. A cloned teacher is a SECOND
 * renderer, mounted only when a class carries one.
 */

const manifest: ClipManifest = {
  formatVersion: 1,
  lessonId: 'l',
  teacher: 'sharma',
  idle: 'idle.mp4',
  beats: {},
};

describe('which face the tile shows', () => {
  it('shows the penguin when no clone is given', () => {
    const html = renderToString(<TutorTile mode="teaching" variant="rail" />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<video');
  });

  it('shows the teacher when a clone is given', () => {
    const html = renderToString(
      <TutorTile
        mode="teaching"
        variant="rail"
        clone={{ manifest, baseUrl: '/x', beatId: 'b1', name: 'Sharma Sir' }}
      />,
    );
    expect(html).toContain('<video');
    // One face at a time: the penguin must not be drawn underneath.
    expect(html).not.toContain('<svg');
  });

  it('puts the teacher own name under their face, never Curie tutor', () => {
    const html = renderToString(
      <TutorTile
        mode="teaching"
        variant="rail"
        clone={{ manifest, baseUrl: '/x', beatId: 'b1', name: 'Sharma Sir' }}
      />,
    );
    expect(html).toContain('Sharma Sir');
    expect(html).not.toContain(TUTOR.name);
  });
});
