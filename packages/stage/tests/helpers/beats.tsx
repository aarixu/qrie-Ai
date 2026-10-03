import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Lesson } from '@ai-tutor/lesson-format';
import { Scene } from '../../src/Scene';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Render one beat after another in a real DOM, the way the class moves, and return the board. */
export function renderBeats(lesson: Lesson, visibleSets: string[][]): HTMLElement {
  const host = document.createElement('div');
  const root = createRoot(host);
  for (const visible of visibleSets) act(() => root.render(<Scene lesson={lesson} visible={visible} focus={[]} />));
  return host;
}
