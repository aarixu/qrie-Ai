import { describe, expect, it } from 'vitest';
import { mergePlan, type Snapshot } from '../src/lib/sync';

/**
 * WHICH SIDE WINS, PER STORE.
 *
 * One student, several devices, and no server refereeing mid-edit: the only
 * honest rule is last-write-wins per store, decided by when each side was
 * last touched. The dangerous case is a FRESH device — empty stores with no
 * history must never be pushed over a year of real progress.
 */

const local = (at: number | null): Snapshot => ({ value: { n: 'local' }, updatedAt: at });
// The cloud always knows when it was written; only a device can be blank.
const cloud = (at: number): { value: unknown; updatedAt: number } => ({
  value: { n: 'cloud' },
  updatedAt: at,
});

describe('merging a device with the cloud', () => {
  it('takes the cloud when it is newer', () => {
    const plan = mergePlan({ progress: local(100) }, { progress: cloud(200) });
    expect(plan.take).toEqual(['progress']);
    expect(plan.send).toEqual([]);
  });

  it('sends the device up when it is newer', () => {
    const plan = mergePlan({ progress: local(300) }, { progress: cloud(200) });
    expect(plan.send).toEqual(['progress']);
    expect(plan.take).toEqual([]);
  });

  it('does nothing when both sides agree on the moment', () => {
    const plan = mergePlan({ progress: local(200) }, { progress: cloud(200) });
    expect(plan.take).toEqual([]);
    expect(plan.send).toEqual([]);
  });

  it('ALWAYS takes the cloud on a device that has never been written to', () => {
    // A fresh phone: the stores exist but hold their empty defaults. Pushing
    // those would wipe the student's real history on every other device.
    const plan = mergePlan({ progress: local(null) }, { progress: cloud(1) });
    expect(plan.take).toEqual(['progress']);
    expect(plan.send).toEqual([]);
  });

  it('sends up a store the cloud has never seen', () => {
    const plan = mergePlan({ notes: local(50) }, {});
    expect(plan.send).toEqual(['notes']);
  });

  it('leaves an untouched store alone when the cloud has nothing either', () => {
    const plan = mergePlan({ notes: local(null) }, {});
    expect(plan.send).toEqual([]);
    expect(plan.take).toEqual([]);
  });

  it('decides each store on its own, not the account as a whole', () => {
    const plan = mergePlan(
      { progress: local(300), notes: local(100) },
      { progress: cloud(200), notes: cloud(400) },
    );
    expect(plan.send).toEqual(['progress']);
    expect(plan.take).toEqual(['notes']);
  });
});
