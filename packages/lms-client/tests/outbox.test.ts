// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createOutbox, isOffline, memoryOutboxStore, type OutboxSend } from '../src/index.ts';

/**
 * THE STUDENT APP'S OUTBOX: WORK THAT WAITS FOR THE INTERNET. Written first.
 *
 * On patchy data a test answer, a hand-in or a notebook photo can fail to
 * leave the phone. It waits in the outbox, kept on the phone, and goes when
 * the school can be reached again — each hand-in under the key it was made
 * with, so the school never counts it twice (0044). A job the school turns
 * down (time is up, no attempts left) is not retried: it is taken out and
 * the reason is kept to show the child. Only a failure to reach the school
 * leaves a job waiting.
 */

const offline = () => new TypeError('Failed to fetch');

function fakeSend(over: Partial<OutboxSend> = {}): OutboxSend & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    saveTestAnswer: async (a, item, chosen) => {
      calls.push(`answer ${a} ${item}=${chosen}`);
    },
    submitMcq: async (a, answers, key) => {
      calls.push(`mcq ${a} ${JSON.stringify(answers)} ${key}`);
      return { submissionId: 's1', correct: 1, total: 2 };
    },
    uploadWork: async (name) => {
      calls.push(`upload ${name}`);
    },
    submitPhotos: async (a, names, key) => {
      calls.push(`photos ${a} ${names.join(',')} ${key}`);
      return 'p1';
    },
    ...over,
  };
}

const mcq = (assignmentId = 'hw1') => ({
  kind: 'mcq' as const,
  assignmentId,
  title: 'Fractions quiz',
  answers: { q1: 1 },
  key: `key-${assignmentId}`,
});

describe('knowing the internet from the school saying no', () => {
  it('takes a failed fetch for no internet, and a sentence from the school for an answer', () => {
    expect(isOffline(new TypeError('Failed to fetch'))).toBe(true);
    expect(isOffline(new Error('TypeError: Failed to fetch'))).toBe(true);
    expect(isOffline(new Error('NetworkError when attempting to fetch resource.'))).toBe(true);
    expect(isOffline(new Error('Load failed'))).toBe(true);
    expect(isOffline(new Error('no attempts left for this homework'))).toBe(false);
    expect(isOffline(new Error('Please sign in again.'))).toBe(false);
  });
});

describe('the outbox', () => {
  it('sends what waits, in order, once the school can be reached', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add({ kind: 'answer', assignmentId: 't1', itemId: 'q1', chosen: 2 });
    await box.add(mcq());
    const send = fakeSend();
    const r = await box.flush(send);
    expect(send.calls).toEqual(['answer t1 q1=2', 'mcq hw1 {"q1":1} key-hw1']);
    expect(r.sent.map((j) => j.kind)).toEqual(['answer', 'mcq']);
    expect(r.refused).toEqual([]);
    expect(await box.pending()).toEqual([]);
  });

  it('sends a hand-in with the time the child spent on it, when the phone measured one (0114)', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add({ ...mcq('hw1'), activeMs: 300_000 });
    await box.add(mcq('hw2'));
    const spent: (number | undefined)[] = [];
    await box.flush(
      fakeSend({
        submitMcq: async (_a, _answers, _key, activeMs) => {
          spent.push(activeMs);
          return { submissionId: 's1', correct: 1, total: 2 };
        },
      }),
    );
    expect(spent).toEqual([300_000, undefined]);
  });

  it('keeps everything, in order, while the school cannot be reached, and sends it later', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add(mcq('hw1'));
    await box.add(mcq('hw2'));
    const down = fakeSend({
      submitMcq: async () => {
        throw offline();
      },
    });
    const r = await box.flush(down);
    expect(r).toEqual({ sent: [], refused: [], waiting: 2 });
    expect((await box.pending()).map((j) => (j.kind === 'mcq' ? j.assignmentId : ''))).toEqual(['hw1', 'hw2']);
    const up = fakeSend();
    expect((await box.flush(up)).sent).toHaveLength(2);
    expect(up.calls).toEqual(['mcq hw1 {"q1":1} key-hw1', 'mcq hw2 {"q1":1} key-hw2']);
  });

  it('keeps everything when the school asks the child to sign in again, for after they do', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add(mcq('hw1'));
    for (const said of ['Please sign in again.', 'JWT expired', 'not signed in']) {
      const r = await box.flush(
        fakeSend({
          submitMcq: async () => {
            throw new Error(said);
          },
        }),
      );
      expect(r).toEqual({ sent: [], refused: [], waiting: 1 });
    }
  });

  it('takes out what the school turns down, with its reason, and goes on with the rest', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add(mcq('hw1'));
    await box.add(mcq('hw2'));
    const send = fakeSend({
      submitMcq: async (a) => {
        if (a === 'hw1') throw new Error('no attempts left for this homework');
        return { submissionId: 's2', correct: 2, total: 2 };
      },
    });
    const r = await box.flush(send);
    expect(r.refused).toEqual([{ job: expect.objectContaining({ assignmentId: 'hw1' }), reason: 'no attempts left for this homework' }]);
    expect(r.sent.map((j) => (j.kind === 'mcq' ? j.assignmentId : ''))).toEqual(['hw2']);
    expect(await box.pending()).toEqual([]);
  });

  it('keeps only the latest answer to each question of a test', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add({ kind: 'answer', assignmentId: 't1', itemId: 'q1', chosen: 0 });
    await box.add({ kind: 'answer', assignmentId: 't1', itemId: 'q2', chosen: 1 });
    await box.add({ kind: 'answer', assignmentId: 't1', itemId: 'q1', chosen: 3 });
    const send = fakeSend();
    await box.flush(send);
    expect(send.calls).toEqual(['answer t1 q2=1', 'answer t1 q1=3']);
  });

  it('sends a test’s waiting answers before its hand-in, whatever order they were added in', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add({ ...mcq('t1') });
    await box.add({ kind: 'answer', assignmentId: 't1', itemId: 'q1', chosen: 2 });
    const send = fakeSend();
    await box.flush(send);
    expect(send.calls).toEqual(['answer t1 q1=2', 'mcq t1 {"q1":1} key-t1']);
  });

  it('uploads photos it has not uploaded yet, then hands them in under their key', async () => {
    const box = createOutbox(memoryOutboxStore());
    const pages = [new Blob(['a']), new Blob(['b']), new Blob(['c'])];
    await box.add({ kind: 'photos', assignmentId: 'hw3', title: 'Notebook', key: 'k3', names: ['n1', 'n2', 'n3'], pages, uploaded: 0 });
    let up = 0;
    const flaky = fakeSend({
      uploadWork: async (name) => {
        if (++up === 2) throw offline();
        flaky.calls.push(`upload ${name}`);
      },
    });
    expect((await box.flush(flaky)).waiting).toBe(1);
    expect(flaky.calls).toEqual(['upload n1']);
    const [waiting] = await box.pending();
    expect(waiting).toMatchObject({ kind: 'photos', uploaded: 1 });
    const send = fakeSend();
    await box.flush(send);
    expect(send.calls).toEqual(['upload n2', 'upload n3', 'photos hw3 n1,n2,n3 k3']);
  });

  it('takes a photo the school already has as uploaded', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add({ kind: 'photos', assignmentId: 'hw4', title: 'Notebook', key: 'k4', names: ['n1'], pages: [new Blob(['a'])], uploaded: 0 });
    const send = fakeSend({
      uploadWork: async () => {
        throw new Error('The resource already exists');
      },
    });
    const r = await box.flush(send);
    expect(r.sent).toHaveLength(1);
    expect(send.calls).toEqual(['photos hw4 n1 k4']);
  });

  it('keeps its jobs in its store, so a closed app finds them again', async () => {
    const store = memoryOutboxStore();
    await createOutbox(store).add(mcq('hw5'));
    expect((await createOutbox(store).pending()).map((j) => j.kind)).toEqual(['mcq']);
  });

  it('runs one flush at a time', async () => {
    const box = createOutbox(memoryOutboxStore());
    await box.add(mcq('hw6'));
    const send = fakeSend();
    await Promise.all([box.flush(send), box.flush(send)]);
    expect(send.calls).toEqual(['mcq hw6 {"q1":1} key-hw6']);
  });

  it('tells its listeners how many jobs wait, whenever that changes', async () => {
    const box = createOutbox(memoryOutboxStore());
    const seen: number[] = [];
    box.subscribe((n) => seen.push(n));
    await box.add(mcq('hw7'));
    await box.flush(fakeSend());
    expect(seen).toEqual([1, 0]);
  });
});
