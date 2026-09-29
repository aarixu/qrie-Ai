import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/supabase', () => ({ supabase: () => null }));
vi.mock('../src/lib/content', () => ({
  findEntry: async (id: string) => ({ id, title: 'Substitution', class: 10, subject: 'Maths', path: '', topicRef: 'x/ch/b' }),
  nextLessonAfter: async () => ({ id: 'next-lesson', title: 'Elimination', class: 10, subject: 'Maths', path: '', topicRef: 'x/ch/c' }),
}));
vi.mock('../src/lib/quiz', () => ({ buildQuiz: () => null }));
vi.mock('../src/lib/graphContext', () => ({ currentIndex: () => ({}) }));
const due = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../src/lib/nextStep', () => ({ beforeNext: async () => due.value }));

const { LessonComplete } = await import('../src/screens/LessonComplete');
const { preferencesStore } = await import('../src/stores/preferences');

async function open(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/complete/l1']}>
        <Routes>
          <Route path="/complete/:lessonId" element={<LessonComplete />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  for (let i = 0; i < 8; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  return host;
}

/** E6-E8: a due review comes before the next lesson, and stops the autoplay. */
describe('the finished class, with a review due', () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    preferencesStore.update((p) => ({ ...p, autoplayNext: true }));
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('offers the review first and does not autoplay the next lesson', async () => {
    due.value = { kind: 'review', titles: ['Outcome A'], route: '/quiz/lesson-a', because: 'due' };
    const host = await open();
    expect(host.textContent).toContain('Quick review first');
    expect(host.textContent).toContain('Outcome A');
    expect(host.textContent).not.toContain('Next lesson in');
  });

  it('autoplays the next lesson when nothing is due', async () => {
    due.value = null;
    const host = await open();
    expect(host.textContent).not.toContain('Quick review first');
    expect(host.textContent).toContain('Next lesson in');
  });
});
