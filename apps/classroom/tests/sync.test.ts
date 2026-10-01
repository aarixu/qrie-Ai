import { beforeEach, describe, expect, it } from 'vitest';
import { mergePlan, type Snapshot } from '../src/lib/sync';
import {
  createLocalStore,
  forgetDeviceOwner,
  handOverDevice,
  touchedAt,
  wipeDevice,
  writeDated,
  writeFromCloud,
} from '../src/stores/localStore';

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

describe('a value taken from the cloud', () => {
  it('keeps the cloud\'s moment, not now — so the next sync does not see this device as newer', () => {
    const notes = createLocalStore('cloud-stamp-test:notes', { text: '' });
    writeFromCloud('cloud-stamp-test:notes', { text: 'from the laptop' }, 123);
    expect(notes.get()).toEqual({ text: 'from the laptop' });
    // store.set stamps every write with Date.now(); the cloud's stamp has to
    // land after it, or it is overwritten by the write it was meant to date.
    expect(touchedAt('cloud-stamp-test:notes')).toBe(123);
  });

  it('a dated write is dated as asked, and still reaches the store\'s listeners', () => {
    const notes = createLocalStore('dated-test:notes', { text: '' });
    let heard = 0;
    const off = notes.subscribe(() => {
      heard += 1;
    });
    writeDated('dated-test:notes', { text: 'inferred' }, 0);
    off();
    expect(notes.get()).toEqual({ text: 'inferred' });
    expect(touchedAt('dated-test:notes')).toBe(0);
    expect(heard).toBe(1);
  });
});

describe('stores that must never reach the cloud', () => {
  it('keeps the safety flag log off the sync registry entirely', async () => {
    // For its first weeks this log WAS synced — every distress flag, and the
    // note a student typed into a report — because registration is automatic
    // and its own file only said "the log is LOCAL" in prose. A rule stated
    // next to a default that contradicts it is not a rule.
    const { registeredStores, neverSyncedKeys } = await import('../src/stores/localStore');
    await import('../src/stores/flags');

    expect([...registeredStores().keys()]).not.toContain('flags');
    expect(neverSyncedKeys().has('flags')).toBe(true);
  });

  it('deletes a key that opted out but is already up there', async () => {
    // Opting out only stops the NEXT push. Rows written before the opt-out are
    // still sitting in student_state, and "we stopped sending it" is a
    // different promise from "it is not there".
    const { connectSync } = await import('../src/lib/sync');
    await import('../src/stores/flags');

    const forgotten: string[] = [];
    const stop = connectSync({
      pull: async () => ({ flags: { value: { flags: [] }, updatedAt: 1 } }),
      push: async () => undefined,
      forget: async (key) => {
        forgotten.push(key);
      },
    });

    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(forgotten).toContain('flags');
  });

  it('does not delete a key that is supposed to be there', async () => {
    const { connectSync } = await import('../src/lib/sync');
    const forgotten: string[] = [];
    const stop = connectSync({
      pull: async () => ({ progress: { value: {}, updatedAt: 1 } }),
      push: async () => undefined,
      forget: async (key) => {
        forgotten.push(key);
      },
    });
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(forgotten).not.toContain('progress');
  });
});

/**
 * A SHARED PHONE, AND WHAT SIGNING IN USED TO DO TO THE PERSON BEFORE YOU.
 *
 * Sync merges what is on the device with what is in the cloud, newest wins,
 * and it had no idea whose work was on the device. A school tablet, a family
 * laptop, a sibling: the first student's notes, name and progress sat in
 * localStorage after they signed out, and the moment the next student signed
 * in, everything of the first student's that happened to be newer was pushed
 * up into the second student's real account.
 */
describe('when the device changes hands', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetDeviceOwner();
  });

  it('claims a device nobody has signed in on, rather than wiping it', () => {
    const notes = createLocalStore('handover-test:notes', { text: '' });
    notes.set({ text: 'what I worked out in class' });

    expect(handOverDevice('student-1')).toBe(0);
    expect(notes.get()).toEqual({ text: 'what I worked out in class' });
  });

  it('leaves everything alone when the same student signs in again', () => {
    const notes = createLocalStore('handover-test:notes-2', { text: '' });
    handOverDevice('student-1');
    notes.set({ text: 'mine' });

    expect(handOverDevice('student-1')).toBe(0);
    expect(notes.get()).toEqual({ text: 'mine' });
  });

  /** The upgrade path keeps the same user id, so it must not look like this. */
  it('does not fire when an anonymous student becomes a named one', () => {
    createLocalStore('handover-test:notes-3', { text: '' }).set({ text: 'a term of work' });
    handOverDevice('same-id');
    expect(handOverDevice('same-id')).toBe(0);
  });

  it('empties the device before the next student can merge over them', () => {
    const notes = createLocalStore('handover-test:notes-4', { text: '' });
    handOverDevice('student-1');
    notes.set({ text: "student one's notes" });

    const cleared = handOverDevice('student-2');

    expect(cleared).toBeGreaterThan(0);
    expect(notes.get()).toEqual({ text: '' });
    expect(localStorage.getItem('handover-test:notes-4')).toBeNull();
    // The write stamp goes too — a stamp left behind would make the empty
    // store look newer than the cloud and push the emptiness up as an edit.
    expect(localStorage.getItem('handover-test:notes-4:at')).toBeNull();
  });

  it('takes the safety flag log with it, which never syncs and is not theirs', () => {
    const flags = createLocalStore('handover-test:flags', [] as string[], { neverSync: true });
    handOverDevice('student-1');
    flags.set(['cleaned']);

    handOverDevice('student-2');
    expect(flags.get()).toEqual([]);
  });
});

/**
 * "DELETE MY ACCOUNT" HAS TO MEAN THE SAME THING EVERYWHERE THE DATA IS.
 *
 * Every server-side table cascades from auth.users, so the rows really do go.
 * The device's own copy did not: a student who asked to be deleted was left
 * with their notes, their name, their progress and their safety flag log still
 * in localStorage, where the next identity on the device would inherit them.
 */
describe('wiping the device', () => {
  beforeEach(() => {
    localStorage.clear();
    forgetDeviceOwner();
  });

  it('clears every store, synced or not, without waiting for anyone to sign in', () => {
    const notes = createLocalStore('wipe-test:notes', { text: '' });
    const flags = createLocalStore('wipe-test:flags', [] as string[], { neverSync: true });
    handOverDevice('student-1');
    notes.set({ text: 'mine' });
    flags.set(['cleaned']);

    expect(wipeDevice()).toBeGreaterThan(0);

    expect(notes.get()).toEqual({ text: '' });
    expect(flags.get()).toEqual([]);
    expect(localStorage.getItem('wipe-test:notes')).toBeNull();
    expect(localStorage.getItem('wipe-test:notes:at')).toBeNull();
  });

  it('forgets who the device belonged to, so the next student is not a handover', () => {
    createLocalStore('wipe-test:notes-2', { text: '' });
    handOverDevice('student-1');
    wipeDevice();
    // Nothing left to hand over, so nothing is reported as discarded.
    expect(handOverDevice('student-2')).toBe(0);
  });
});
