import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useLoad } from '../src/features/billing/use-load.ts';

/**
 * THE BILLING PAGES' READ HOOK, rendered in jsdom. Written first.
 *
 * Record a payment reads the chosen invoice with this hook, keyed by its id,
 * and posts to the id of the data it holds. So the data must belong to the
 * key on screen: none while the new key's read is out, and never a late
 * answer for an older key.
 */

const roots: Root[] = [];
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

type Seen = { key: string; data: string | null; loading: boolean };

function deferred() {
  let resolve!: (v: string) => void;
  const promise = new Promise<string>((r) => (resolve = r));
  return { promise, resolve };
}

async function mount(reads: Record<string, Promise<string>>, first: string) {
  const seen: Seen[] = [];
  function Probe({ k }: { k: string }) {
    const r = useLoad(() => reads[k], k);
    seen.push({ key: k, data: r.data, loading: r.loading });
    return null;
  }
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  roots.push(root);
  await act(async () => root.render(<Probe k={first} />));
  return { seen, rerender: (k: string) => act(async () => root.render(<Probe k={k} />)) };
}

describe('billing useLoad', () => {
  it("a late answer for the previous key never replaces the current key's data", async () => {
    const a = deferred();
    const b = deferred();
    const { seen, rerender } = await mount({ A: a.promise, B: b.promise }, 'A');
    await rerender('B');
    await act(async () => b.resolve('invoice B'));
    await act(async () => a.resolve('invoice A'));
    expect(seen.at(-1)).toEqual({ key: 'B', data: 'invoice B', loading: false });
    expect(seen.filter((s) => s.key === 'B').map((s) => s.data)).not.toContain('invoice A');
  });

  it("while the new key's read is out, the old key's data is not offered", async () => {
    const a = deferred();
    const b = deferred();
    const { seen, rerender } = await mount({ A: a.promise, B: b.promise }, 'A');
    await act(async () => a.resolve('invoice A'));
    expect(seen.at(-1)).toEqual({ key: 'A', data: 'invoice A', loading: false });
    await rerender('B');
    for (const s of seen.filter((x) => x.key === 'B')) expect(s).toMatchObject({ data: null, loading: true });
    await act(async () => b.resolve('invoice B'));
    expect(seen.at(-1)).toEqual({ key: 'B', data: 'invoice B', loading: false });
  });
});
