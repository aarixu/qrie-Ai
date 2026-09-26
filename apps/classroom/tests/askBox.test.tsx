import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * THE GATE IS OFF FOR THIS FILE.
 *
 * Both doors this box opens are always cold — a typed topic and an uploaded
 * page carry no topicRef and so can never match a class that exists — which
 * means PROTOTYPE_ONLY_PREPARED freezes the whole control. Every assertion
 * below is about what the box does when it can do anything. The frozen
 * behaviour is pinned in prototypeGate.test.tsx.
 */
vi.mock('../src/lib/prototype', async (real) => ({
  ...(await real<typeof import('../src/lib/prototype')>()),
  PROTOTYPE_ONLY_PREPARED: false,
}));
import { AskBox } from '../src/ui/AskBox';
import { takeSource, forgetSources } from '../src/lib/sourceHandoff';

/**
 * THE DOOR ITSELF.
 *
 * A student types what they want, or hands over a page. Both end at the same
 * route; what this file is about is that the FAILURES happen HERE, in front of
 * the box they chose the file with, and that each of them leaves something to
 * press. A refusal that arrives after the classroom has opened is a black
 * stage that promised a class and delivered an apology.
 *
 * No mocks. The real reader opens the real bytes, because the failures being
 * checked — a photograph, a binary, an enormous file — are exactly the ones a
 * stand-in cannot have.
 */

const roots: Root[] = [];
let path = '';

function Wherever() {
  path = `${useLocation().pathname}${useLocation().search}`;
  return null;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  forgetSources();
  path = '';
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

async function open(): Promise<HTMLElement> {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/']}>
        <AskBox />
        <Routes>
          <Route path="*" element={<Wherever />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return host;
}

/**
 * Let the reading finish.
 *
 * Opening a file is not a microtask: the reader itself is fetched with a
 * dynamic import, and where Blob.arrayBuffer is missing it falls back to
 * FileReader, whose load event is a macrotask. An `await act()` that only
 * drains the microtask queue left every one of these tests looking at
 * "Reading…" — so this waits for that word to go, with a bound so a reader
 * that never finishes fails the test rather than hanging it.
 */
async function settle(host: HTMLElement): Promise<void> {
  for (let i = 0; i < 40 && host.textContent?.includes('Reading '); i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Pick a file, the way the browser hands one over. */
async function choose(host: HTMLElement, file: File): Promise<void> {
  const input = host.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) throw new Error('there is no way to hand over a file');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(host);
}

const button = (host: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll('button')].find(
    (b) => b.textContent?.includes(label) || b.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`no button says "${label}"`);
  return found;
};

const NOTES =
  'Ohm ka law kehta hai ki V = I R. Resistance depends on length and area of the wire.';

describe('typing what you want to learn', () => {
  it('goes to a class off the syllabus', async () => {
    const host = await open();
    const input = host.querySelector<HTMLInputElement>('input[type=text], input:not([type])');
    if (!input) throw new Error('there is nothing to type in');

    await act(async () => {
      // React tracks the last value it set on the node, so assigning .value
      // directly makes it think nothing changed. This is how the event a real
      // keystroke produces is reproduced.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, 'why is the sky blue');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      button(host, 'Start this class').click();
    });

    expect(path).toBe('/class?topic=why%20is%20the%20sky%20blue');
  });
});

describe('handing over a page', () => {
  it('reads it here, and only then offers the class', async () => {
    const host = await open();
    await choose(host, new File([NOTES], 'Ohms law notes.txt'));

    expect(host.textContent).toContain('Ohms law notes');
    expect(path).toBe('/');

    await act(async () => {
      button(host, 'Teach this').click();
    });

    const key = new URLSearchParams(path.split('?')[1]).get('source');
    expect(key).toBeTruthy();
    expect(takeSource(key ?? '')?.text).toBe(NOTES);
  });

  it('says how much of a long page she will teach', async () => {
    const host = await open();
    await choose(host, new File(['Chlorophyll absorbs light. '.repeat(2000)], 'chapter.txt'));

    expect(host.textContent).toContain('the opening');
  });
});

describe('the ways a file fails, all of them in front of the student', () => {
  it('a photograph of a page', async () => {
    const jpeg = new Uint8Array(400);
    jpeg.set([0xff, 0xd8, 0xff, 0xe0]);
    const host = await open();
    await choose(host, new File([jpeg], 'page.jpg'));

    expect(host.textContent).toContain('picture of a page');
    // The refusal is not the end of the road: both of these are on the screen.
    expect(button(host, 'Choose another file')).toBeTruthy();
    expect(button(host, 'Never mind')).toBeTruthy();
    expect(path).toBe('/');
  });

  it('a file too big to open on a phone', async () => {
    const enormous = {
      name: 'scanned book.pdf',
      size: 200 * 1024 * 1024,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    } as unknown as File;
    const host = await open();
    await choose(host, enormous);

    expect(host.textContent).toContain('too big');
  });

  it('a file that is not what its name claims', async () => {
    const song = new Uint8Array(1200);
    song.set([0x49, 0x44, 0x33, 0x04]);
    for (let i = 4; i < song.length; i += 1) song[i] = i % 5 === 0 ? 0x00 : 0xa7;
    const host = await open();
    await choose(host, new File([song], 'chapter 6.txt'));

    expect(host.textContent).toContain('cannot open that kind of file');
  });

  it('leaves the box usable afterwards', async () => {
    const host = await open();
    await choose(host, new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], 'page.jpg'));
    await act(async () => {
      button(host, 'Never mind').click();
    });

    expect(host.textContent).not.toContain('picture of a page');
    await choose(host, new File([NOTES], 'notes.txt'));
    expect(button(host, 'Teach this')).toBeTruthy();
  });
});
