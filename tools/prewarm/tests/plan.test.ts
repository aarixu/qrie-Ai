import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyState, markTopic, saveState } from '../lib/state.mjs';
import { dedupeSyllabi, planFor } from '../lib/plan.mjs';

/**
 * THE PLAN IS THE BILL. Everything the operator approves — the topic count,
 * the Rs figure, what the state file already paid for — is computed here, so
 * the arithmetic is pinned here rather than in a hand-run CLI transcript that
 * does not survive the next edit.
 */
describe('naming a syllabus twice', () => {
  it('counts it once', () => {
    // --syllabus class9-science --all-class9-10-science is the real spelling
    // of this mistake, and the operator reads the topic count as the bill.
    expect(dedupeSyllabi(['class9-science', 'class9-science', 'class10-science'])).toEqual([
      'class9-science',
      'class10-science',
    ]);
    expect(dedupeSyllabi(['class9-science', 'class10-science'])).toEqual([
      'class9-science',
      'class10-science',
    ]);
  });

  it('plans one entry, and therefore one state object, per syllabus', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-plan-'));
    const plan = planFor({
      syllabi: ['class9-science', 'class9-science'],
      stateDir: dir,
    });
    expect(plan).toHaveLength(1);
    // Two plan entries would hold two state objects loaded from one file, and
    // the second pass's save would erase the first pass's done rows.
    const once = planFor({ syllabi: ['class9-science'], stateDir: dir });
    expect(plan[0].rows.length).toBe(once[0].rows.length);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('what the state file has already paid for', () => {
  it('drops done and skipped from pending, keeps failed', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-plan-'));
    const all = planFor({ syllabi: ['class9-science'], stateDir: dir })[0];
    const [a, b, c] = all.rows.map((r) => r.path);

    const state = emptyState('class9-science');
    markTopic(state, a, { status: 'done' });
    markTopic(state, b, { status: 'skipped', reason: 'already kept' });
    markTopic(state, c, { status: 'failed', reason: 'model had a moment' });
    saveState(dir, state);

    const after = planFor({ syllabi: ['class9-science'], stateDir: dir })[0];
    expect(after.pending.has(a)).toBe(false);
    expect(after.pending.has(b)).toBe(false);
    expect(after.pending.has(c)).toBe(true);
    expect(after.pending.size).toBe(all.rows.length - 2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
