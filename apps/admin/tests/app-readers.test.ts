// @vitest-environment node
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { freshDatabase } from '../../../supabase/tests/harness.ts';
import { isBelowMinimum } from '../../../packages/lms-client/src/app-config.ts';
import { APP_READERS, FIRST_BUILD } from '../src/lib/app-readers.ts';

/**
 * WHO READS WHICH SWITCH, as the console's Apps page and switch lines say it.
 * Written first.
 */

const ALL_KEYS = [
  'banner.message',
  'banner.tone',
  'tutor.enabled',
  'tutor.only_prepared',
  'tutor.compose_live_classes',
  'contest.entries_open',
  'contest.daily_limit',
  'app.min_version.classroom',
  'app.min_version.student',
  'app.min_version.lms',
  'billing.state',
];

describe('the Apps page', () => {
  it('every registered switch is listed with who reads it', async () => {
    const listed = new Set(APP_READERS.flatMap((r) => r.reads));
    expect([...listed].sort()).toEqual([...ALL_KEYS].sort());

    // The registered switches are admin.flag_def's rows (on every migration),
    // plus billing.state, which public.app_config adds for a school (0060).
    const db = await freshDatabase();
    try {
      const keys = (await db.query<{ key: string }>(`select key from admin.flag_def order by key`)).rows.map((r) => r.key);
      expect([...keys, 'billing.state'].sort()).toEqual([...ALL_KEYS].sort());
    } finally {
      await db.close();
    }
  }, 120_000);

  it("each app's first reading build is not newer than its package.json", () => {
    for (const app of ['classroom', 'student', 'lms'] as const) {
      const pkg = JSON.parse(fs.readFileSync(new URL(`../../${app}/package.json`, import.meta.url), 'utf8')) as { version: string };
      expect(isBelowMinimum(pkg.version, FIRST_BUILD[app]), app).toBe(false);
    }
  });
});
