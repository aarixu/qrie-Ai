import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { Lesson } from '@ai-tutor/lesson-format';
import { usePlayer } from '../src/usePlayer';
import type { TtsAdapter } from '../src/narration';

// The hook is a thin binding — all timing logic is covered in controller.test.ts,
// so the UI side gets a renderToString smoke test only.

const silentTts: TtsAdapter = {
  speak: () => Promise.resolve(),
  cancel: () => {},
};

const lesson: Lesson = {
  formatVersion: 1,
  id: 'mini',
  title: 'Mini',
  language: 'en',
  canvas: { w: 1000, h: 620 },
  elements: [{ kind: 'title', id: 'e1', x: 0, y: 0, text: 'T' }],
  beats: [
    { id: 'b0', topic: 'zero', narration: 'beat zero caption', show: ['e1'] },
    { id: 'b1', topic: 'one', narration: 'beat one caption', show: ['e1'] },
  ],
};

function Probe() {
  const player = usePlayer(lesson, silentTts);
  return (
    <div>
      <span>{player.state}</span>
      <span>{String(player.beatIndex)}</span>
      <span>{player.beat?.id ?? 'none'}</span>
      <p>{player.caption}</p>
    </div>
  );
}

describe('usePlayer', () => {
  it('renders the idle state with the first beat and its caption', () => {
    const html = renderToString(<Probe />);
    expect(html).toContain('idle');
    expect(html).toContain('b0');
    expect(html).toContain('beat zero caption');
  });
});
