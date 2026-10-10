// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  return { out, deps: { log: (l: string) => out.push(l), env } };
}

/** A project that has nothing yet, and remembers every row it is sent. */
function emptyProject() {
  const posted: { path: string; rows: Record<string, unknown>[] }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if ((init?.method ?? 'GET') === 'GET') return new Response('[]');
    posted.push({ path: new URL(url).pathname, rows: JSON.parse(String(init!.body)) });
    return new Response(null, { status: 201 });
  }) as unknown as typeof fetch;
  const rows = (path: string) => posted.filter((p) => p.path === path).flatMap((p) => p.rows);
  return { fetchImpl, items: () => rows('/rest/v1/item'), outcomes: () => rows('/rest/v1/outcome') };
}

const PROJECT = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };

describe('lms-library', () => {
  it('dry-runs by default: counts the real banks it would load and writes nothing', async () => {
    const t = io();
    expect(await run([], t.deps)).toBe(0);
    const text = t.out.join('\n');
    expect(text).toMatch(/DRY RUN/);
    expect(text).toMatch(/1862 items from 5 banks/);
    expect(text).toMatch(/1862 outcomes, each with its chapter/);
  });

  it('skips Classes 6-9 by default, and says exactly what it skipped, class by class', async () => {
    const t = io();
    expect(await run([], t.deps)).toBe(0);
    const text = t.out.join('\n');
    expect(text).toContain('Skipped Classes 6-9: their banks come from the old NCERT books, not the current syllabus.');
    expect(text).toContain('Class 6: 526 items and 526 outcomes (class6-mathematics, class6-science)');
    expect(text).toContain('Class 7: 481 items and 481 outcomes (class7-mathematics, class7-science)');
    expect(text).toContain('Class 8: 1115 items and 1115 outcomes (class8-mathematics, class8-science)');
    expect(text).toContain('Class 9: 713 items and 1095 outcomes (class9-mathematics, class9-science)');
    expect(text).toContain('--include-old-books-6-9');
    // The banks it would load are listed; the skipped ones are not among them.
    expect(text).toMatch(/class10-science: 371/);
    expect(text).not.toMatch(/class8-science: \d+/);
  });

  it('loads Classes 6-9 too only when asked to with --include-old-books-6-9, and says so', async () => {
    const t = io();
    expect(await run(['--include-old-books-6-9'], t.deps)).toBe(0);
    const text = t.out.join('\n');
    expect(text).toMatch(/4697 items from 13 banks/);
    expect(text).toMatch(/class8-science: 762/);
    expect(text).toContain('Including Classes 6-9 from the old NCERT books (--include-old-books-6-9).');
    expect(text).not.toContain('Skipped Classes 6-9');
  });

  it('refuses --apply without the project URL and service role key', async () => {
    const t = io();
    expect(await run(['--apply'], t.deps)).toBe(1);
    expect(t.out.join('\n')).toMatch(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('writes no question and no outcome of Classes 6-9 with --apply, unless asked to', async () => {
    const plain = emptyProject();
    const t = io(PROJECT);
    expect(await run(['--apply'], { ...t.deps, fetchImpl: plain.fetchImpl })).toBe(0);
    expect(plain.items()).toHaveLength(1862);
    expect(plain.outcomes()).toHaveLength(1862);
    expect(new Set(plain.items().map((r) => r.grade))).toEqual(new Set([10, 11]));
    expect(new Set(plain.outcomes().map((r) => r.grade))).toEqual(new Set([10, 11]));
    expect(t.out.join('\n')).toContain('Class 8: 1115 items and 1115 outcomes (class8-mathematics, class8-science)');

    const all = emptyProject();
    const u = io(PROJECT);
    expect(await run(['--apply', '--include-old-books-6-9'], { ...u.deps, fetchImpl: all.fetchImpl })).toBe(0);
    expect(all.items()).toHaveLength(4697);
    expect(new Set(all.items().map((r) => r.grade))).toEqual(new Set([6, 7, 8, 9, 10, 11]));
  });
});
