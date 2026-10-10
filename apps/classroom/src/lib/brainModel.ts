import type { ServerModel } from '@ai-tutor/lms-brain';
import { readServerWith, refreshFromServer } from './learnerModel';
import { accountFromStoredSession, onAccountChange, supabase } from './supabase';

/**
 * THE SERVER'S MODEL OF THIS LEARNER, READ BY THE TUTOR (lam-one-brain Task 11).
 *
 * The brain (packages/lms-brain think.ts) folds everything a learner did —
 * the school's homework and the tutor's own classes alike — into
 * concept_state. public.my_learner_model() (0109) hands the signed-in
 * learner their rows and the brain's cursor in one statement; the model store
 * builds on them (learnerModel.ts `refreshFromServer`).
 *
 * Null whenever there is nothing to read — no project configured, nobody
 * signed in, no answer within READ_TIMEOUT_MS, an error — and the store keeps
 * the device's own model, as it did before the tutor read the server at all.
 */

/** Long enough for a slow phone network, short enough that a hung read is let go. */
const READ_TIMEOUT_MS = 8_000;

export interface ServerRead {
  server: ServerModel;
  /** Who it is about: the signed-in account. */
  owner: string;
}

const isServerModel = (data: unknown): data is ServerModel =>
  typeof data === 'object' && data !== null && Array.isArray((data as ServerModel).states);

export async function readServerModel(timeoutMs: number = READ_TIMEOUT_MS): Promise<ServerRead | null> {
  const db = supabase();
  if (!db) return null;
  // The stored session, not a request: whose model this is must not wait on the network.
  const who = await accountFromStoredSession();
  if (!who.known || !who.account) return null;
  const answer = await Promise.race([
    Promise.resolve(db.rpc('my_learner_model')).then(
      (r) => r,
      () => null,
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!answer || answer.error || !isServerModel(answer.data)) return null;
  return { server: answer.data, owner: who.account.id };
}

/**
 * Let the model store read the server's model (learnerModel.ts
 * `readServerWith`), and read it at sign-in: the first time each account is
 * seen, which includes the session restored when the app opens. Returns the
 * detach function, in the shape main.tsx uses for the other listeners.
 */
export function startServerModel(): () => void {
  readServerWith(readServerModel);
  let seen: string | null = null;
  const off = onAccountChange((account) => {
    if (!account) {
      seen = null;
      return;
    }
    if (account.id === seen) return;
    seen = account.id;
    void refreshFromServer();
  });
  return () => {
    off();
    readServerWith(null);
  };
}
