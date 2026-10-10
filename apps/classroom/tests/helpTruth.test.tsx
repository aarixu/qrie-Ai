import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { Help } from '../src/screens/Help';
import { Onboarding } from '../src/screens/Onboarding';
import { MEERA_IS_AN_AI } from '../src/lib/aboutMeera';

/**
 * WHAT A CHILD IS TOLD ABOUT HER IS TRUE (persona v3, Aarav 2026-10-10).
 *
 * Meera says she is an AI only when asked, so the app says it once, plainly,
 * where a child and a parent read about her: onboarding, where they first meet
 * her, and Help. And Help told every child each class "was taught live once,
 * to real students, and recorded" — untrue for every class here — and that "a
 * live tutor takes over" a raised hand, which a child reads as a person.
 */

const text = (html: string): string =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');

describe('Help', () => {
  const help = text(renderToString(<MemoryRouter><Help /></MemoryRouter>));

  it('says plainly that Meera is an AI', () => {
    expect(MEERA_IS_AN_AI).toMatch(/Meera[^.]*\bAI\b/);
    expect(help).toContain(MEERA_IS_AN_AI);
  });

  it('no longer claims the classes were taught live to real students and recorded', () => {
    expect(help).not.toMatch(/taught live once/i);
    expect(help).not.toMatch(/real students/i);
  });

  it('does not call the one who answers a raised hand "a live tutor"', () => {
    expect(help).not.toMatch(/a live tutor/i);
  });
});

describe('Onboarding', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('says it where the child first meets her, the step that asks their name', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Onboarding />
        </MemoryRouter>,
      );
    });
    const own = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes("I'm here on my own"));
    if (!own) throw new Error('no way through the first door');
    await act(async () => {
      own.click();
    });
    expect(host.querySelector('input[aria-label="Your first name"]')).not.toBeNull();
    expect(host.textContent).toContain(MEERA_IS_AN_AI);
    act(() => root.unmount());
  });
});
