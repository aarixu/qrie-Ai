import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Onboarding } from '../src/screens/Onboarding';
import { Enrol } from '../src/screens/contest/Enrol';
import { MAX_NAME_CHARS } from '../src/lib/student';

/**
 * THE NAME FIELD HAS AN END.
 *
 * It had none: a paragraph pasted into "What should I call you?" was stored
 * whole and printed on every greeting. The cap is forty characters, held in
 * the field itself and not only by the attribute — `maxLength` stops typing,
 * not a paste through an IME or an autofill that sets the value directly.
 */

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

async function openAtName(): Promise<HTMLInputElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/onboarding']}>
        <Onboarding />
      </MemoryRouter>,
    );
  });
  const own = [...host.querySelectorAll('button')].find((b) =>
    b.textContent?.includes("I'm here on my own"),
  );
  if (!own) throw new Error('no way through the first door');
  await act(async () => {
    own.click();
  });
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Your first name"]');
  if (!input) throw new Error('the name step has no name field');
  return input;
}

/** Set a value the way the browser does, so React's onChange sees it. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the onboarding name', () => {
  it('tells the browser where the field ends', async () => {
    const input = await openAtName();
    expect(input.maxLength).toBe(MAX_NAME_CHARS);
    expect(MAX_NAME_CHARS).toBe(40);
  });

  it('keeps no more than forty characters of a pasted paragraph', async () => {
    const input = await openAtName();
    await typeInto(input, 'Ananya '.repeat(20));
    expect(input.value.length).toBeLessThanOrEqual(40);
    expect(input.value.startsWith('Ananya')).toBe(true);
  });

  it('leaves an ordinary name exactly as typed', async () => {
    const input = await openAtName();
    await typeInto(input, 'Aarav');
    expect(input.value).toBe('Aarav');
  });
});

/** The contest door asks the same question of a parent, and keeps the same cap. */
describe('the enrolment name', () => {
  async function openEnrol(): Promise<HTMLInputElement> {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/enrol']}>
          <Enrol />
        </MemoryRouter>,
      );
    });
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="Student's first name"]`);
    if (!input) throw new Error('the first enrolment screen has no name field');
    return input;
  }

  it('ends at forty characters too', async () => {
    const input = await openEnrol();
    expect(input.maxLength).toBe(MAX_NAME_CHARS);
    await typeInto(input, 'Ananya '.repeat(20));
    expect(input.value.length).toBeLessThanOrEqual(40);
  });
});

/** Aarav, 2026-09-30: no mascot in the onboarding wizard. */
describe('the onboarding wizard', () => {
  it('shows no tutor tile, on the first door or the name step', async () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/onboarding']}>
          <Onboarding />
        </MemoryRouter>,
      );
    });
    const tile = () => host.querySelector('[aria-label$=" teaching"]');
    expect(tile()).toBeNull();
    const own = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes("I'm here on my own"))!;
    await act(async () => {
      own.click();
    });
    expect(host.querySelector('input[aria-label="Your first name"]')).not.toBeNull();
    expect(tile()).toBeNull();
  });
});
