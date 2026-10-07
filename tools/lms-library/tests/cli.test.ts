// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.ts';

function io(env: Record<string, string> = {}) {
  const out: string[] = [];
  return { out, deps: { log: (l: string) => out.push(l), env } };
}

describe('lms-library', () => {
  it('dry-runs by default: counts the real banks and writes nothing', async () => {
    const t = io();
    expect(await run([], t.deps)).toBe(0);
    const text = t.out.join('\n');
    expect(text).toMatch(/DRY RUN/);
    expect(text).toMatch(/4697 items from 13 banks/);
    expect(text).toMatch(/\d+ outcomes, each with its chapter/);
  });

  it('refuses --apply without the project URL and service role key', async () => {
    const t = io();
    expect(await run(['--apply'], t.deps)).toBe(1);
    expect(t.out.join('\n')).toMatch(/SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
  });
});
