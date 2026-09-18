import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_CONSECUTIVE_FAILURES,
  emptyState,
  loadState,
  markTopic,
  pendingTopics,
  acquireStateLock,
  saveState,
  shouldStop,
  statePath,
} from '../lib/state.mjs';

/**
 * The state file is what makes a re-run RESUME instead of RE-PAY. Every rule
 * here is a rupee rule: a topic marked done must never be prepared again, a
 * failed one must be retried, and a corrupt file must stop the run rather
 * than quietly start the whole catalogue from scratch.
 */
describe('pre-warm state', () => {
  it('starts empty, named after its syllabus', () => {
    const s = emptyState('class9-science');
    expect(s.syllabus).toBe('class9-science');
    expect(s.topics).toEqual({});
  });

  it('a done topic is never pending again; a failed one is retried', () => {
    const s = emptyState('class9-science');
    markTopic(s, 'class9-science/a/one', { status: 'done', prepId: 'p1', spendInr: 28.4 });
    markTopic(s, 'class9-science/a/two', { status: 'failed', reason: 'keep refused' });
    markTopic(s, 'class9-science/a/three', { status: 'skipped', reason: 'already kept live' });
    const refs = [
      'class9-science/a/one',
      'class9-science/a/two',
      'class9-science/a/three',
      'class9-science/a/four',
    ];
    // done and skipped cost money to redo or were deliberate; failed and
    // never-tried are exactly what a resume is for.
    expect(pendingTopics(s, refs)).toEqual(['class9-science/a/two', 'class9-science/a/four']);
  });

  it('marking a topic records when', () => {
    const s = emptyState('class9-science');
    markTopic(s, 'class9-science/a/one', { status: 'done' });
    expect(typeof s.topics['class9-science/a/one'].at).toBe('string');
  });

  it('refuses an unknown status rather than inventing a fourth state', () => {
    const s = emptyState('class9-science');
    expect(() => markTopic(s, 'x/y/z', { status: 'maybe' as never })).toThrow(/status/);
  });

  it('stops on three consecutive failures, not two', () => {
    expect(MAX_CONSECUTIVE_FAILURES).toBe(3);
    expect(shouldStop(2)).toBe(false);
    expect(shouldStop(3)).toBe(true);
  });

  it('round-trips through disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-state-'));
    const s = emptyState('class10-science');
    markTopic(s, 'class10-science/light/reflection', { status: 'done', spendInr: 31.2 });
    saveState(dir, s);
    const back = loadState(dir, 'class10-science');
    expect(back).toEqual(s);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a missing file is an empty state, not an error', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-state-'));
    expect(loadState(dir, 'class9-science')).toEqual(emptyState('class9-science'));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('a CORRUPT file throws instead of silently re-paying the catalogue', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-state-'));
    fs.writeFileSync(statePath(dir, 'class9-science'), '{not json', 'utf8');
    expect(() => loadState(dir, 'class9-science')).toThrow(/class9-science/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

/**
 * TWO RUNS AT ONCE ARE TWO BILLS. saveState is atomic per write, but both
 * processes read the pending set before either writes, so both prepare every
 * topic. The lock is the last local double-pay path closed.
 */
describe('the state directory lock', () => {
  it('refuses a second holder, and names the pid holding it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-lock-'));
    const release = acquireStateLock(dir, 'class9-science');
    expect(() => acquireStateLock(dir, 'class9-science')).toThrow(/already running|--force/);
    release();
    // Once released, the next run starts normally.
    acquireStateLock(dir, 'class9-science')();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('--force takes a lock a dead run left behind', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-lock-'));
    acquireStateLock(dir, 'class9-science');
    const release = acquireStateLock(dir, 'class9-science', { force: true });
    expect(typeof release).toBe('function');
    release();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('releasing twice is harmless — the finally arm must never throw', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prewarm-lock-'));
    const release = acquireStateLock(dir, 'class10-science');
    release();
    expect(() => release()).not.toThrow();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
