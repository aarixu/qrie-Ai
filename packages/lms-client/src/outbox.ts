import type { McqResult } from './api.ts';

/**
 * THE STUDENT APP'S OUTBOX: WORK THAT WAITS FOR THE INTERNET.
 *
 * A test answer, a hand-in or a notebook photo that could not leave the phone
 * waits here, in a store kept on the phone, and goes when the school can be
 * reached again. Each hand-in goes under the key it was made with, so the
 * school never counts it twice (migration 0044). A job the school turns down
 * is taken out, with the school's reason, and not retried; a failure to reach
 * the school, or the school asking the child to sign in again, leaves it
 * waiting. A test's waiting answers go before
 * any hand-in, so a test is never handed in without them.
 */

export interface AnswerJob {
  id: string;
  kind: 'answer';
  assignmentId: string;
  itemId: string;
  chosen: number | null;
}

export interface McqJob {
  id: string;
  kind: 'mcq';
  assignmentId: string;
  title: string;
  answers: Record<string, number>;
  key: string;
}

export interface PhotosJob {
  id: string;
  kind: 'photos';
  assignmentId: string;
  title: string;
  key: string;
  /** Where each page goes in storage (lms.work_path). */
  names: string[];
  pages: Blob[];
  /** How many of the pages the school already has. */
  uploaded: number;
}

export type OutboxJob = AnswerJob | McqJob | PhotosJob;
export type NewOutboxJob = Omit<AnswerJob, 'id'> | Omit<McqJob, 'id'> | Omit<PhotosJob, 'id'>;

/** How the outbox reaches the school: the app's api and storage. */
export interface OutboxSend {
  saveTestAnswer(assignmentId: string, itemId: string, chosen: number | null): Promise<void>;
  submitMcq(assignmentId: string, answers: Record<string, number>, key: string): Promise<McqResult>;
  uploadWork(objectName: string, file: Blob): Promise<void>;
  submitPhotos(assignmentId: string, objectNames: string[], key: string): Promise<string>;
}

/** Where the jobs are kept: on the phone in the app (IndexedDB), in memory in tests. */
export interface OutboxStore {
  load(): Promise<OutboxJob[]>;
  save(jobs: OutboxJob[]): Promise<void>;
}

export function memoryOutboxStore(): OutboxStore {
  let jobs: OutboxJob[] = [];
  return {
    load: async () => [...jobs],
    save: async (next) => {
      jobs = [...next];
    },
  };
}

const NO_INTERNET =
  /failed to fetch|networkerror|network request failed|load failed|fetch failed|internet disconnected|network connection was lost/i;

/** Whether a failed call never reached the school, as opposed to the school saying no. */
export function isOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (error instanceof TypeError) return true;
  return NO_INTERNET.test(error instanceof Error ? error.message : String(error ?? ''));
}

/** A random id for a job or a hand-in key; works where crypto.randomUUID does not (plain http). */
export function newKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The school asking the child to sign in again: the job waits for that, it is not turned down. */
const SIGN_IN_AGAIN = /sign in again|jwt expired|invalid jwt|not signed in/i;

/** Whether a failed job should wait and be tried again, rather than be taken out. */
function shouldWait(error: unknown): boolean {
  return isOffline(error) || SIGN_IN_AGAIN.test(error instanceof Error ? error.message : String(error ?? ''));
}

const ALREADY_THERE = /already exists|duplicate/i;

export interface FlushResult {
  sent: OutboxJob[];
  refused: { job: OutboxJob; reason: string }[];
  /** Jobs still waiting for the internet. */
  waiting: number;
}

export function createOutbox(store: OutboxStore) {
  const listeners = new Set<(waiting: number) => void>();
  const tell = (n: number) => listeners.forEach((l) => l(n));
  let running: Promise<FlushResult> | null = null;

  async function add(job: NewOutboxJob): Promise<void> {
    let jobs = await store.load();
    // A test answer replaces any earlier answer to the same question.
    if (job.kind === 'answer') {
      jobs = jobs.filter((j) => !(j.kind === 'answer' && j.assignmentId === job.assignmentId && j.itemId === job.itemId));
    }
    jobs.push({ ...job, id: newKey() } as OutboxJob);
    await store.save(jobs);
    tell(jobs.length);
  }

  async function sendOne(job: OutboxJob, send: OutboxSend, keep: (j: OutboxJob) => Promise<void>): Promise<void> {
    if (job.kind === 'answer') return send.saveTestAnswer(job.assignmentId, job.itemId, job.chosen);
    if (job.kind === 'mcq') {
      await send.submitMcq(job.assignmentId, job.answers, job.key);
      return;
    }
    for (let i = job.uploaded; i < job.pages.length; i += 1) {
      try {
        await send.uploadWork(job.names[i], job.pages[i]);
      } catch (e) {
        if (shouldWait(e) || !ALREADY_THERE.test(e instanceof Error ? e.message : String(e))) throw e;
      }
      job.uploaded = i + 1;
      await keep(job);
    }
    await send.submitPhotos(job.assignmentId, job.names, job.key);
  }

  async function run(send: OutboxSend): Promise<FlushResult> {
    const result: FlushResult = { sent: [], refused: [], waiting: 0 };
    const all = await store.load();
    // Answers first, so a test is never handed in before its answers are saved.
    const queue = [...all.filter((j) => j.kind === 'answer'), ...all.filter((j) => j.kind !== 'answer')];
    let left = [...queue];
    const persist = async () => store.save(left);
    const keep = async (j: OutboxJob) => {
      left = left.map((x) => (x.id === j.id ? j : x));
      await persist();
    };
    for (const job of queue) {
      try {
        await sendOne(job, send, keep);
        result.sent.push(job);
      } catch (e) {
        if (shouldWait(e)) break;
        result.refused.push({ job, reason: e instanceof Error ? e.message : String(e) });
      }
      left = left.filter((x) => x.id !== job.id);
      await persist();
    }
    result.waiting = left.length;
    tell(left.length);
    return result;
  }

  return {
    add,
    pending: () => store.load(),
    /** Sends what waits; one flush at a time, a second call joining the first. */
    flush(send: OutboxSend): Promise<FlushResult> {
      running ??= run(send).finally(() => {
        running = null;
      });
      return running;
    },
    subscribe(listener: (waiting: number) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type Outbox = ReturnType<typeof createOutbox>;
