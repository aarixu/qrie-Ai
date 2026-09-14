import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE SECOND PLACE A STUDENT HAS ALREADY TYPED WHAT THEY WANT.
 *
 * Search used to end at "Nothing found", which is the wrong answer twice over:
 * the catalogue not holding a lesson is a fact about the catalogue, and the
 * student is standing on the one screen in the app where they have already
 * said, in words, what they want to learn. Those words go to the same room the
 * home screen's Ask box sends its own to.
 *
 * The catalogue is stood aside because it is a network fetch, and an empty one
 * is the state under test: nothing recorded, nothing in the syllabus, and a
 * student who still gets a class.
 */

vi.mock('../src/lib/content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/content')>()),
  fetchCatalog: () => Promise.resolve([]),
}));

const { Search } = await import('../src/screens/Search');

const roots: Root[] = [];
let path = '';

function Wherever() {
  const location = useLocation();
  path = `${location.pathname}${location.search}`;
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  path = '';
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('searching for something no lesson covers', () => {
  it('offers the class instead of a dead end', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/search']}>
          <Search />
          <Routes>
            <Route path="*" element={<Wherever />} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const input = host.querySelector<HTMLInputElement>('input');
    if (!input) throw new Error('there is nothing to search in');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'quantum tunnelling');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(host.textContent).toContain('she can still teach it');

    const ask = [...host.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Ask her to teach it'),
    );
    if (!ask) throw new Error('the dead end is still a dead end');
    await act(async () => ask.click());

    expect(path).toBe('/class?topic=quantum%20tunnelling');
  });
});
