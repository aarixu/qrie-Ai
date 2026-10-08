// @vitest-environment node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freshDatabase, migrationFiles } from './harness';

/**
 * THE MIGRATIONS, RUN — NOT READ.
 *
 * Until now every migration test in this repo read the .sql file and matched
 * it with a regex (apps/classroom/tests/migrations.test.ts says so at its top).
 * That stops a policy being deleted; it cannot tell you what the policy does.
 * This harness applies every file in supabase/migrations, in order, to a real
 * Postgres running in-process (PGlite), so a test can act as a student and see
 * what a student would actually see.
 */
describe('the migration harness', () => {
  it('finds every migration in order', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);
    expect(files[0]).toBe('0001_student_state.sql');
    expect([...files].sort()).toEqual(files);
  });

  it('gives every migration its own number, and runs every .sql file there', () => {
    // The Supabase CLI keys a migration by its number: of two files with one
    // number, the second fails `db push` or is taken as applied and skipped.
    // Two lanes numbering from the same free slot meet here at merge.
    const all = fs
      .readdirSync(fileURLToPath(new URL('../migrations/', import.meta.url)))
      .filter((f) => f.endsWith('.sql'));
    expect(all.sort()).toEqual(migrationFiles());
    const byNumber = new Map<string, string[]>();
    for (const f of all) byNumber.set(f.slice(0, 4), [...(byNumber.get(f.slice(0, 4)) ?? []), f]);
    expect([...byNumber.values()].filter((files) => files.length > 1)).toEqual([]);
  });

  it('applies all of them to a fresh Postgres without error', async () => {
    const db = await freshDatabase();
    const { rows } = await db.sql<{ n: number }>`select count(*)::int as n from public.organization`;
    expect(rows[0].n).toBe(0);
    await db.close();
  });
});
