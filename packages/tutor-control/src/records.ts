import type { HelpedPayload, IntervenedPayload } from '@ai-tutor/ledger';
import type { Action } from './types.ts';

/** One ledger record an action owes, in the order it must be filed. */
export type ActionRecord =
  | { kind: 'helped'; payload: HelpedPayload }
  | { kind: 'intervened'; payload: IntervenedPayload };

/**
 * WHAT THE LEDGER GETS FOR AN ACTION, IN FILING ORDER (E3).
 *
 * 1. `helped`, when the action gives help — BEFORE a word is spoken or a line
 *    written. The fold reads an answer as cold only when no `helped` row for
 *    that ask came before it in `seq` order, so help that reaches the child
 *    ahead of its record manufactures unassisted mastery (see `deriveRung`).
 * 2. `intervened`, for EVERY action, with its reason and error class. Today
 *    nothing emits it; the ledger has defined it since the start.
 *
 * `ref` names the ask the same way the answer will (`beatId` in a class,
 * `probeId` in a quiz), so the fold's ask key joins the help to the answer.
 * Pure: the caller files these through its ledger store; this only says what
 * they are.
 */
export function recordsFor(action: Action, ref: { beatId?: string; probeId?: string }): ActionRecord[] {
  const records: ActionRecord[] = [];
  const names = {
    ...(ref.beatId !== undefined ? { beatId: ref.beatId } : {}),
    ...(ref.probeId !== undefined ? { probeId: ref.probeId } : {}),
  };
  if (action.helped !== null) {
    records.push({
      kind: 'helped',
      payload: { ...names, rung: action.helped, requested: action.requested },
    });
  }
  records.push({
    kind: 'intervened',
    payload: {
      action: action.kind,
      because: action.because,
      rung: action.rung,
      errorClass: action.errorClass,
    },
  });
  return records;
}
